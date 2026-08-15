import { COOKIE_NAME } from "../shared/const.js";
import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  aiConversionJobs,
  aiProviderConfigs,
  botLogs,
  bots,
  conversionChunks,
  conversionDependencies,
  conversionFiles,
  conversionProjects,
  deployments,
  runnerJobs,
} from "../drizzle/schema.js";
import { getBotForUser, getDb, getLatestDeployment, listBotLogsForUser, listBotsForUser, listRunnerJobs } from "./db.js";
import {
  encryptSecret,
  encryptTelegramToken,
  isPlausibleProviderKey,
  isPlausibleTelegramToken,
  isTokenEncryptionConfigured,
  redactSensitiveText,
} from "../server/bot-security.js";
import { dispatchRunnerAction, isRunnerAuthorized, isRunnerConfigured, processRunnerReport } from "../server/runner.js";
import { storagePut } from "../server/storage.js";
import { callCompatibleProvider, defaultProviderConfig, validateProviderUrl } from "../server/ai-provider.js";
import { createChunkPlan, processConversionChunks, rebuildPackageManifest, CONVERSION_MAX_FILE_BYTES, sha256 } from "../server/ai-conversion.js";
import { getSessionCookieOptions } from "../server/_core/cookies.js";
import { systemRouter } from "../server/_core/systemRouter.js";
import { protectedProcedure, publicProcedure, router } from "../server/_core/trpc.js";

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_REQUIREMENTS_BYTES = 128 * 1024;
const safeName = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/);
const fileInput = z.object({
  name: z.string().min(1).max(120),
  base64: z.string().min(1),
  size: z.number().int().positive().max(MAX_SOURCE_BYTES),
});

function decodeUpload(base64: string, maxBytes: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new Error("Uploaded file is not valid Base64 content.");
  }
  const value = Buffer.from(base64, "base64");
  if (value.length === 0 || value.length > maxBytes || value.includes(0)) {
    throw new Error("Uploaded file exceeds the allowed size or contains unsupported binary content.");
  }
  return value;
}

function sourceVersion(source: Buffer, requirements: Buffer) {
  return crypto.createHash("sha256").update(source).update(requirements).digest("hex");
}

function runnerCallbackUrl(request: { protocol: string; get: (name: string) => string | undefined }) {
  const configured = (process.env.BOT_RUNNER_CALLBACK_URL ?? "").replace(/\/+$/, "");
  if (configured) return `${configured}/api/runner/report`;
  const forwardedProto = request.get("x-forwarded-proto")?.split(",")[0];
  const forwardedHost = request.get("x-forwarded-host")?.split(",")[0];
  const protocol = forwardedProto || request.protocol || "https";
  const host = forwardedHost || request.get("host");
  return host ? `${protocol}://${host}/api/runner/report` : undefined;
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  bot: router({
    secretReadiness: protectedProcedure.query(() => ({
      tokenEncryptionConfigured: isTokenEncryptionConfigured(),
      runnerConfigured: isRunnerConfigured(),
    })),

    list: protectedProcedure.query(async ({ ctx }) => listBotsForUser(ctx.user.id)),

    detail: protectedProcedure.input(z.object({ botId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const bot = await getBotForUser(input.botId, ctx.user.id);
      if (!bot) return null;
      const [deployment, logs, jobs] = await Promise.all([
        getLatestDeployment(bot.id),
        listBotLogsForUser(bot.id, ctx.user.id),
        listRunnerJobs(bot.id),
      ]);
      return { bot, deployment, logs: logs ?? [], jobs };
    }),

    logs: protectedProcedure.input(z.object({ botId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      return (await listBotLogsForUser(input.botId, ctx.user.id)) ?? [];
    }),

    upload: protectedProcedure
      .input(
        z.object({
          name: safeName,
          runtime: z.enum(["python", "node"]).default("python"),
          source: fileInput,
          requirements: fileInput,
          token: z.string().trim().min(1).max(256),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!isTokenEncryptionConfigured()) {
          throw new Error("Secure token storage is not configured. Add BOT_TOKEN_ENCRYPTION_KEY before uploading a bot.");
        }
        if (!isPlausibleTelegramToken(input.token)) {
          throw new Error("The Telegram bot token format looks invalid.");
        }

        if (input.runtime === "python") {
          if (!input.source.name.toLowerCase().endsWith(".py")) throw new Error("Choose one Python source file ending in .py.");
          if (input.requirements.name !== "requirements.txt") throw new Error("Choose a dependency file named requirements.txt.");
        } else {
          if (!/\.(js|ts|mjs|cjs)$/.test(input.source.name.toLowerCase())) throw new Error("Choose one Node.js entry file (.js, .ts, .mjs, or .cjs).");
          if (input.requirements.name !== "package.json") throw new Error("Choose a package.json as the dependency file.");
        }

        const source = decodeUpload(input.source.base64, MAX_SOURCE_BYTES);
        const requirements = decodeUpload(input.requirements.base64, MAX_REQUIREMENTS_BYTES);
        if (source.length !== input.source.size || requirements.length !== input.requirements.size) {
          throw new Error("The uploaded file sizes do not match their content.");
        }

        const db = await getDb();
        const sourceKeyPrefix = `bot-sources/${ctx.user.id}/${crypto.randomUUID()}`;
        const [sourceArtifact, requirementsArtifact] = await Promise.all([
          storagePut(`${sourceKeyPrefix}/${input.source.name}`, source, input.runtime === "python" ? "text/x-python" : "text/javascript"),
          storagePut(`${sourceKeyPrefix}/${input.requirements.name}`, requirements, "text/plain"),
        ]);
        const token = encryptTelegramToken(input.token);
        const hash = sourceVersion(source, requirements);
        const inserted = await db
          .insert(bots)
          .values({
            userId: ctx.user.id,
            name: input.name,
            runtime: input.runtime,
            entryFile: input.source.name,
            sourceKey: sourceArtifact.key,
            requirementsKey: requirementsArtifact.key,
            sourceHash: sourceVersion(source, Buffer.alloc(0)),
            requirementsHash: sourceVersion(Buffer.alloc(0), requirements),
            tokenCiphertext: token.ciphertext,
            tokenIv: token.iv,
            tokenAuthTag: token.authTag,
            status: "draft",
            desiredState: "stopped",
          })
          .returning({ id: bots.id });
        const botId = inserted[0].id;
        const deployment = await db.insert(deployments).values({ botId, sourceVersion: hash, status: "queued" }).returning({ id: deployments.id });
        await db.insert(botLogs).values({
          botId,
          deploymentId: deployment[0].id,
          level: "info",
          message: "Source package uploaded. Click Start to run the bot locally.",
        });
        return { botId };
      }),

    start: protectedProcedure.input(z.object({ botId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const bot = await getBotForUser(input.botId, ctx.user.id);
      if (!bot) throw new Error("Bot not found.");
      if (bot.status === "running" || bot.status === "starting") return { status: bot.status, queued: false };
      const deployment = await getLatestDeployment(bot.id);
      if (!deployment) throw new Error("Upload the bot source before starting it.");
      const db = await getDb();
      await db.update(bots).set({ status: "starting", desiredState: "running", lastError: null, updatedAt: new Date() }).where(and(eq(bots.id, bot.id), eq(bots.userId, ctx.user.id)));
      const jobResult = await db.insert(runnerJobs).values({ botId: bot.id, deploymentId: deployment.id, action: "start", status: "processing", attempts: 1 }).returning({ id: runnerJobs.id });
      const jobId = jobResult[0].id;
      const dispatch = await dispatchRunnerAction({ action: "start", bot, deployment, jobId, callbackUrl: runnerCallbackUrl(ctx.req) });
      if (!dispatch.accepted) {
        await db.transaction(async (tx) => {
          await tx.update(runnerJobs).set({ status: "failed", error: dispatch.error, completedAt: new Date() }).where(eq(runnerJobs.id, jobId));
          await tx.update(bots).set({ status: "failed", desiredState: "stopped", lastError: dispatch.error, updatedAt: new Date() }).where(eq(bots.id, bot.id));
          await tx.insert(botLogs).values({ botId: bot.id, deploymentId: deployment.id, level: "error", message: redactSensitiveText(dispatch.error ?? "Runner dispatch failed.") });
        });
        return { status: "failed" as const, queued: false, error: dispatch.error };
      }
      await db.update(runnerJobs).set({ runnerJobId: dispatch.runnerJobId, status: "queued" }).where(eq(runnerJobs.id, jobId));
      await db.update(bots).set({ status: "running", lastStartedAt: new Date(), updatedAt: new Date() }).where(eq(bots.id, bot.id));
      return { status: "starting" as const, queued: true };
    }),

    stop: protectedProcedure.input(z.object({ botId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const bot = await getBotForUser(input.botId, ctx.user.id);
      if (!bot) throw new Error("Bot not found.");
      if (bot.status === "stopped" || bot.status === "draft") return { status: bot.status, queued: false };
      const deployment = await getLatestDeployment(bot.id);
      if (!deployment) throw new Error("Deployment not found.");
      const db = await getDb();
      await db.update(bots).set({ status: "stopping", desiredState: "stopped", updatedAt: new Date() }).where(and(eq(bots.id, bot.id), eq(bots.userId, ctx.user.id)));
      const jobResult = await db.insert(runnerJobs).values({ botId: bot.id, deploymentId: deployment.id, action: "stop", status: "processing", attempts: 1 }).returning({ id: runnerJobs.id });
      const jobId = jobResult[0].id;
      const dispatch = await dispatchRunnerAction({ action: "stop", bot, deployment, jobId, callbackUrl: runnerCallbackUrl(ctx.req) });
      if (!dispatch.accepted) {
        await db.transaction(async (tx) => {
          await tx.update(runnerJobs).set({ status: "failed", error: dispatch.error, completedAt: new Date() }).where(eq(runnerJobs.id, jobId));
          await tx.update(bots).set({ status: "failed", lastError: dispatch.error, updatedAt: new Date() }).where(eq(bots.id, bot.id));
        });
        return { status: "failed" as const, queued: false, error: dispatch.error };
      }
      await db.update(runnerJobs).set({ runnerJobId: dispatch.runnerJobId, status: "queued" }).where(eq(runnerJobs.id, jobId));
      return { status: "stopping" as const, queued: true };
    }),

    runnerReport: publicProcedure
      .input(z.object({
        jobId: z.number().int().positive(),
        status: z.enum(["succeeded", "failed"]),
        runnerJobId: z.string().max(160).optional(),
        error: z.string().max(2000).optional(),
        logLine: z.string().max(4000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!isRunnerAuthorized(ctx.req.headers.authorization)) throw new Error("Runner authentication failed.");
        return processRunnerReport(input);
      }),
  }),

  ai: router({
    providers: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        .select({ id: aiProviderConfigs.id, provider: aiProviderConfigs.provider, label: aiProviderConfigs.label, baseUrl: aiProviderConfigs.baseUrl, model: aiProviderConfigs.model, enabled: aiProviderConfigs.enabled, verifiedAt: aiProviderConfigs.verifiedAt, lastError: aiProviderConfigs.lastError })
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.userId, ctx.user.id))
        .orderBy(desc(aiProviderConfigs.updatedAt));
    }),

    providerDefaults: protectedProcedure.input(z.object({ provider: z.enum(["deepseek", "nvidia"]) })).query(({ input }) => defaultProviderConfig(input.provider)),

    saveProvider: protectedProcedure
      .input(z.object({ provider: z.enum(["deepseek", "nvidia"]), label: z.string().trim().min(1).max(80), baseUrl: z.string().trim().url().max(512), model: z.string().trim().min(1).max(160), apiKey: z.string().trim().min(12).max(256) }))
      .mutation(async ({ ctx, input }) => {
        if (!isTokenEncryptionConfigured()) throw new Error("Secure provider-key storage is not configured on the server.");
        if (!isPlausibleProviderKey(input.apiKey)) throw new Error("The provider key format looks invalid.");
        const baseUrl = validateProviderUrl(input.baseUrl);
        const encrypted = encryptSecret(input.apiKey);
        const db = await getDb();
        const existing = (await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.userId, ctx.user.id), eq(aiProviderConfigs.provider, input.provider))).limit(1))[0];
        if (existing) {
          await db.update(aiProviderConfigs).set({ label: input.label, baseUrl, model: input.model, keyCiphertext: encrypted.ciphertext, keyIv: encrypted.iv, keyAuthTag: encrypted.authTag, enabled: 1, lastError: null, verifiedAt: null, updatedAt: new Date() }).where(eq(aiProviderConfigs.id, existing.id));
          return { id: existing.id };
        }
        const inserted = await db.insert(aiProviderConfigs).values({ userId: ctx.user.id, provider: input.provider, label: input.label, baseUrl, model: input.model, keyCiphertext: encrypted.ciphertext, keyIv: encrypted.iv, keyAuthTag: encrypted.authTag, enabled: 1 }).returning({ id: aiProviderConfigs.id });
        return { id: inserted[0].id };
      }),

    verifyProvider: protectedProcedure.input(z.object({ providerConfigId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const config = (await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.id, input.providerConfigId), eq(aiProviderConfigs.userId, ctx.user.id))).limit(1))[0];
      if (!config) throw new Error("Provider configuration not found.");
      try {
        await callCompatibleProvider(config, [{ role: "user", content: "Reply with the single word READY." }], 16);
        await db.update(aiProviderConfigs).set({ verifiedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(aiProviderConfigs.id, config.id));
        return { verified: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider verification failed.";
        await db.update(aiProviderConfigs).set({ lastError: redactSensitiveText(message), updatedAt: new Date() }).where(eq(aiProviderConfigs.id, config.id));
        return { verified: false, error: message };
      }
    }),

    projects: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      return db
        .select({ id: conversionProjects.id, name: conversionProjects.name, runtime: conversionProjects.runtime, entryFile: conversionProjects.entryFile, status: conversionProjects.status, progress: conversionProjects.progress, lastError: conversionProjects.lastError, createdAt: conversionProjects.createdAt, updatedAt: conversionProjects.updatedAt })
        .from(conversionProjects)
        .where(eq(conversionProjects.userId, ctx.user.id))
        .orderBy(desc(conversionProjects.updatedAt));
    }),

    projectDetail: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const db = await getDb();
      const project = (await db.select().from(conversionProjects).where(and(eq(conversionProjects.id, input.projectId), eq(conversionProjects.userId, ctx.user.id))).limit(1))[0];
      if (!project) return null;
      const [files, chunks, dependencies, jobs] = await Promise.all([
        db.select({ id: conversionFiles.id, path: conversionFiles.path, runtime: conversionFiles.runtime, byteSize: conversionFiles.byteSize, status: conversionFiles.status, isEntry: conversionFiles.isEntry, isSupportFile: conversionFiles.isSupportFile }).from(conversionFiles).where(eq(conversionFiles.projectId, project.id)),
        db.select({ id: conversionChunks.id, fileId: conversionChunks.fileId, chunkIndex: conversionChunks.chunkIndex, startLine: conversionChunks.startLine, endLine: conversionChunks.endLine, status: conversionChunks.status, error: conversionChunks.error }).from(conversionChunks).where(eq(conversionChunks.projectId, project.id)).orderBy(asc(conversionChunks.fileId), asc(conversionChunks.chunkIndex)),
        db.select().from(conversionDependencies).where(eq(conversionDependencies.projectId, project.id)).orderBy(asc(conversionDependencies.name)),
        db.select().from(aiConversionJobs).where(eq(aiConversionJobs.projectId, project.id)).orderBy(desc(aiConversionJobs.createdAt)).limit(5),
      ]);
      return { project, files, chunks, dependencies, jobs };
    }),

    createProject: protectedProcedure
      .input(
        z.object({
          name: safeName,
          runtime: z.enum(["python", "node"]),
          entryFile: z.string().trim().min(1).max(240),
          prompt: z.string().trim().max(4000).optional(),
          providerConfigId: z.number().int().positive(),
          files: z.array(z.object({ path: z.string().trim().min(1).max(512), content: z.string().min(1), byteSize: z.number().int().positive().max(CONVERSION_MAX_FILE_BYTES), isEntry: z.boolean().optional(), isSupportFile: z.boolean().optional() })).min(1).max(40),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        const provider = (await db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.id, input.providerConfigId), eq(aiProviderConfigs.userId, ctx.user.id), eq(aiProviderConfigs.enabled, 1))).limit(1))[0];
        if (!provider) throw new Error("Choose a saved and enabled AI provider first.");
        if (!input.files.some((f) => f.path === input.entryFile)) throw new Error("The entry file must be included in the uploaded project.");
        const sanitized = input.files.map((f) => ({ ...f, path: f.path.replace(/^\/+/, "").replace(/\\/g, "/") })).filter((f) => !f.path.split("/").some((p) => p === ".."));
        const projectKeyPrefix = `ai-projects/${ctx.user.id}/${crypto.randomUUID()}`;
        const storedFiles = await Promise.all(sanitized.map(async (f) => ({ ...f, contentKey: (await storagePut(`${projectKeyPrefix}/source/${f.path}`, Buffer.from(f.content, "utf8"), "text/plain")).key })));
        const manifest = Buffer.from(JSON.stringify(storedFiles.map(({ path, byteSize, isEntry, isSupportFile, contentKey }) => ({ path, byteSize, isEntry, isSupportFile, contentKey }))), "utf8");
        const manifestArtifact = await storagePut(`${projectKeyPrefix}/manifest.json`, manifest, "application/json");
        const inserted = await db
          .insert(conversionProjects)
          .values({ userId: ctx.user.id, providerConfigId: provider.id, name: input.name, runtime: input.runtime, entryFile: input.entryFile, prompt: input.prompt, status: "queued", progress: 0, sourceManifestKey: manifestArtifact.key })
          .returning({ id: conversionProjects.id });
        const projectId = inserted[0].id;
        const jobId = await createChunkPlan(
          { id: projectId, userId: ctx.user.id, providerConfigId: provider.id, name: input.name, runtime: input.runtime, entryFile: input.entryFile, prompt: input.prompt ?? null, status: "queued", progress: 0, sourceManifestKey: manifestArtifact.key, reconstructedPackageKey: null, outputBotId: null, lastError: null, createdAt: new Date(), updatedAt: new Date() },
          storedFiles.map((f) => ({ path: f.path, content: f.content, contentKey: f.contentKey, byteSize: f.byteSize, runtime: input.runtime, isEntry: f.isEntry ?? f.path === input.entryFile, isSupportFile: f.isSupportFile ?? false })),
          provider,
        );
        await processConversionChunks(projectId, jobId, provider, input.prompt ?? "");
        return { projectId, jobId };
      }),

    deployConvertedProject: protectedProcedure
      .input(z.object({ projectId: z.number().int().positive(), name: safeName, token: z.string().trim().min(1).max(256) }))
      .mutation(async ({ ctx, input }) => {
        if (!isPlausibleTelegramToken(input.token)) throw new Error("The Telegram bot token format looks invalid.");
        const db = await getDb();
        const project = (await db.select().from(conversionProjects).where(and(eq(conversionProjects.id, input.projectId), eq(conversionProjects.userId, ctx.user.id))).limit(1))[0];
        if (!project || project.status !== "ready" || !project.reconstructedPackageKey) throw new Error("Complete a successful reconstruction before creating a runnable bot.");
        const encrypted = encryptTelegramToken(input.token);
        const packageHash = sha256(project.reconstructedPackageKey);
        const inserted = await db
          .insert(bots)
          .values({ userId: ctx.user.id, name: input.name, runtime: project.runtime, entryFile: project.entryFile, sourceKey: project.reconstructedPackageKey, requirementsKey: project.reconstructedPackageKey, sourceHash: packageHash, requirementsHash: packageHash, tokenCiphertext: encrypted.ciphertext, tokenIv: encrypted.iv, tokenAuthTag: encrypted.authTag, status: "draft", desiredState: "stopped" })
          .returning({ id: bots.id });
        const botId = inserted[0].id;
        const deployment = await db.insert(deployments).values({ botId, sourceVersion: packageHash, status: "ready" }).returning({ id: deployments.id });
        await db.insert(botLogs).values({ botId, deploymentId: deployment[0].id, level: "info", message: `Reconstructed ${project.runtime} project handed off as a runnable bot.` });
        await db.update(conversionProjects).set({ outputBotId: botId, updatedAt: new Date() }).where(eq(conversionProjects.id, project.id));
        return { botId };
      }),

    toggleDependency: protectedProcedure
      .input(z.object({ projectId: z.number().int().positive(), dependencyId: z.number().int().positive(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        const project = (await db.select({ id: conversionProjects.id }).from(conversionProjects).where(and(eq(conversionProjects.id, input.projectId), eq(conversionProjects.userId, ctx.user.id))).limit(1))[0];
        if (!project) throw new Error("Conversion project not found.");
        await db.update(conversionDependencies).set({ enabled: input.enabled ? 1 : 0 }).where(and(eq(conversionDependencies.id, input.dependencyId), eq(conversionDependencies.projectId, input.projectId)));
        await rebuildPackageManifest(input.projectId);
        return { enabled: input.enabled };
      }),
  }),
});

export type AppRouter = typeof appRouter;
