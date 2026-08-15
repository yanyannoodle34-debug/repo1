import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  aiConversionJobs,
  conversionChunks,
  conversionDependencies,
  conversionFiles,
  conversionProjects,
  reconstructedFiles,
  type AiProviderConfig,
  type ConversionProject,
} from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { storageGetSignedUrl, storagePut } from "./storage.js";
import { callCompatibleProvider, stripCodeFences } from "./ai-provider.js";

export const CONVERSION_CHUNK_LINES = 120;
export const CONVERSION_MAX_FILE_BYTES = 512 * 1024;

export type ProjectInputFile = {
  path: string;
  content: string;
  byteSize: number;
  runtime: "python" | "node";
  contentKey?: string;
  isEntry?: boolean;
  isSupportFile?: boolean;
};

export function splitIntoChunks(content: string, maxLines = CONVERSION_CHUNK_LINES) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const chunks: Array<{ chunkIndex: number; startLine: number; endLine: number; sourceText: string }> = [];
  for (let start = 0, index = 0; start < lines.length; start += maxLines, index += 1) {
    const end = Math.min(start + maxLines, lines.length);
    chunks.push({ chunkIndex: index, startLine: start + 1, endLine: end, sourceText: lines.slice(start, end).join("\n") });
  }
  return chunks;
}

export function discoverDependencies(file: ProjectInputFile) {
  const rows: Array<{ name: string; versionSpec?: string; manager: "pip" | "npm" | "pnpm" | "yarn" | "system"; sourceFile: string; reason: string }> = [];
  if (file.path === "requirements.txt") {
    for (const line of file.content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*([<>=!~].*)?$/);
      if (match) rows.push({ name: match[1], versionSpec: match[2], manager: "pip", sourceFile: file.path, reason: "Listed in requirements.txt" });
    }
  }
  if (["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(file.path)) {
    const manager = file.path.startsWith("pnpm") ? "pnpm" : file.path.startsWith("yarn") ? "yarn" : "npm";
    try {
      const parsed = JSON.parse(file.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const [name, versionSpec] of Object.entries({ ...parsed.dependencies, ...parsed.devDependencies })) {
        rows.push({ name, versionSpec, manager, sourceFile: file.path, reason: "Listed in package manifest" });
      }
    } catch {
      // malformed manifests surfaced as project errors later
    }
  }
  return rows;
}

export function sha256(content: string) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function conversionPrompt(runtime: "python" | "node", instruction: string, filePath: string, startLine: number, endLine: number, sourceText: string) {
  return `You are converting and repairing a ${runtime} bot project one source chunk at a time. Return ONLY replacement source code for the supplied line range, without Markdown fences or commentary. Preserve behavior unless the user instruction explicitly requests a change. Keep imports and symbols compatible with adjacent chunks. User instruction: ${instruction || "Improve compatibility and make the bot runnable."}\n\nFile: ${filePath}\nLines: ${startLine}-${endLine}\n\nSOURCE CHUNK:\n${sourceText}`;
}

export async function createChunkPlan(project: ConversionProject, files: ProjectInputFile[], _provider: AiProviderConfig) {
  const db = await getDb();
  const totalChunks = files.reduce((sum, file) => sum + splitIntoChunks(file.content).length, 0);
  await db.update(conversionProjects).set({ status: "converting", progress: 5, lastError: null, updatedAt: new Date() }).where(eq(conversionProjects.id, project.id));
  for (const file of files) {
    const inserted = await db
      .insert(conversionFiles)
      .values({
        projectId: project.id,
        path: file.path,
        runtime: file.runtime,
        contentKey: file.contentKey ?? `inline://${project.id}/${file.path}`,
        byteSize: file.byteSize,
        sha256: sha256(file.content),
        status: "processing",
        isEntry: file.isEntry ? 1 : 0,
        isSupportFile: file.isSupportFile ? 1 : 0,
      })
      .returning({ id: conversionFiles.id });
    const fileId = inserted[0].id;
    for (const chunk of splitIntoChunks(file.content)) {
      await db.insert(conversionChunks).values({ projectId: project.id, fileId, chunkIndex: chunk.chunkIndex, startLine: chunk.startLine, endLine: chunk.endLine, sourceText: chunk.sourceText, status: "queued" });
    }
    for (const dep of discoverDependencies(file)) {
      await db.insert(conversionDependencies).values({ projectId: project.id, ...dep, enabled: 1 }).onConflictDoNothing();
    }
  }
  const job = await db.insert(aiConversionJobs).values({ projectId: project.id, status: "processing", totalChunks }).returning({ id: aiConversionJobs.id });
  return job[0].id;
}

export async function processConversionChunks(projectId: number, jobId: number, provider: AiProviderConfig, instruction: string) {
  const db = await getDb();
  const project = (await db.select().from(conversionProjects).where(eq(conversionProjects.id, projectId)).limit(1))[0];
  if (!project) throw new Error("Conversion project not found.");
  const pending = await db
    .select({ chunk: conversionChunks, file: conversionFiles })
    .from(conversionChunks)
    .innerJoin(conversionFiles, eq(conversionChunks.fileId, conversionFiles.id))
    .where(and(eq(conversionChunks.projectId, projectId), eq(conversionChunks.status, "queued")))
    .orderBy(asc(conversionChunks.fileId), asc(conversionChunks.chunkIndex));

  let completed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const item of pending) {
    await db.update(conversionChunks).set({ status: "processing" }).where(eq(conversionChunks.id, item.chunk.id));
    try {
      const result = await callCompatibleProvider(
        { provider: provider.provider, baseUrl: provider.baseUrl, model: provider.model, keyCiphertext: provider.keyCiphertext, keyIv: provider.keyIv, keyAuthTag: provider.keyAuthTag },
        [
          { role: "system", content: "You are a precise source-code transformer. Never include secrets, commentary, or Markdown fences in the returned code." },
          { role: "user", content: conversionPrompt(project.runtime, instruction, item.file.path, item.chunk.startLine, item.chunk.endLine, item.chunk.sourceText) },
        ],
      );
      await db.update(conversionChunks).set({ status: "succeeded", resultText: stripCodeFences(result.text), inputTokens: result.inputTokens, outputTokens: result.outputTokens, completedAt: new Date() }).where(eq(conversionChunks.id, item.chunk.id));
      completed += 1;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      await db.update(aiConversionJobs).set({ completedChunks: completed, inputTokens: totalInputTokens, outputTokens: totalOutputTokens }).where(eq(aiConversionJobs.id, jobId));
      await db.update(conversionProjects).set({ progress: Math.min(95, Math.round((completed / Math.max(pending.length, 1)) * 90) + 5), updatedAt: new Date() }).where(eq(conversionProjects.id, projectId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI conversion failed.";
      await db.update(conversionChunks).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(conversionChunks.id, item.chunk.id));
      await db.update(aiConversionJobs).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(aiConversionJobs.id, jobId));
      await db.update(conversionProjects).set({ status: "failed", lastError: message, updatedAt: new Date() }).where(eq(conversionProjects.id, projectId));
      throw new Error(message);
    }
  }
  await reconstructProject(projectId);
  await db.update(aiConversionJobs).set({ status: "succeeded", completedChunks: completed, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, completedAt: new Date() }).where(eq(aiConversionJobs.id, jobId));
  await db.update(conversionProjects).set({ status: "ready", progress: 100, updatedAt: new Date() }).where(eq(conversionProjects.id, projectId));
  return { completedChunks: completed, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

export async function reconstructProject(projectId: number) {
  const db = await getDb();
  const files = await db.select().from(conversionFiles).where(eq(conversionFiles.projectId, projectId)).orderBy(asc(conversionFiles.id));
  const packageFiles: Array<{ path: string; content: string; sha256: string }> = [];
  for (const file of files) {
    const chunks = await db.select().from(conversionChunks).where(and(eq(conversionChunks.projectId, projectId), eq(conversionChunks.fileId, file.id))).orderBy(asc(conversionChunks.chunkIndex));
    if (chunks.some((c) => c.status !== "succeeded" || !c.resultText)) throw new Error(`Cannot reconstruct ${file.path} until every chunk succeeds.`);
    const content = chunks.map((c) => c.resultText ?? "").join("\n");
    const artifact = await storagePut(`ai-projects/${projectId}/reconstructed/${file.path}`, Buffer.from(content, "utf8"), "text/plain");
    await db.insert(reconstructedFiles).values({ projectId, sourceFileId: file.id, path: file.path, contentKey: artifact.key, sha256: sha256(content), byteSize: Buffer.byteLength(content, "utf8") });
    packageFiles.push({ path: file.path, content, sha256: sha256(content) });
    await db.update(conversionFiles).set({ status: "completed" }).where(eq(conversionFiles.id, file.id));
  }
  const enabledDeps = await db
    .select({ name: conversionDependencies.name, versionSpec: conversionDependencies.versionSpec, manager: conversionDependencies.manager })
    .from(conversionDependencies)
    .where(and(eq(conversionDependencies.projectId, projectId), eq(conversionDependencies.enabled, 1)));
  const packageArtifact = await storagePut(
    `ai-projects/${projectId}/reconstructed/package.json`,
    Buffer.from(JSON.stringify({ version: 1, projectId, files: packageFiles, dependencies: enabledDeps }), "utf8"),
    "application/json",
  );
  await db.update(conversionProjects).set({ reconstructedPackageKey: packageArtifact.key, progress: 98, updatedAt: new Date() }).where(eq(conversionProjects.id, projectId));
}

export async function rebuildPackageManifest(projectId: number) {
  const db = await getDb();
  const files = await db.select().from(reconstructedFiles).where(eq(reconstructedFiles.projectId, projectId)).orderBy(asc(reconstructedFiles.id));
  const packageFiles = await Promise.all(
    files.map(async (file) => {
      const signedUrl = await storageGetSignedUrl(file.contentKey);
      const response = await fetch(signedUrl, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Unable to refresh reconstructed file ${file.path}.`);
      return { path: file.path, content: await response.text(), sha256: file.sha256 };
    }),
  );
  const enabledDeps = await db
    .select({ name: conversionDependencies.name, versionSpec: conversionDependencies.versionSpec, manager: conversionDependencies.manager })
    .from(conversionDependencies)
    .where(and(eq(conversionDependencies.projectId, projectId), eq(conversionDependencies.enabled, 1)));
  const packageArtifact = await storagePut(
    `ai-projects/${projectId}/reconstructed/package.json`,
    Buffer.from(JSON.stringify({ version: 1, projectId, files: packageFiles, dependencies: enabledDeps }), "utf8"),
    "application/json",
  );
  await db.update(conversionProjects).set({ reconstructedPackageKey: packageArtifact.key, updatedAt: new Date() }).where(eq(conversionProjects.id, projectId));
  return packageArtifact.key;
}
