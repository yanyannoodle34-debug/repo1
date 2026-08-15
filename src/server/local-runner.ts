import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";
import { botLogs, bots, runnerJobs } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { storageGet } from "./storage.js";
import { redactSensitiveText } from "./bot-security.js";

const runningProcesses = new Map<number, ChildProcess>();

export function isLocalRunnerAvailable() {
  return true;
}

export function localRunnerJobId(botId: number, pid: number) {
  return `local-${botId}-${pid}`;
}

export async function localStartBot(params: {
  botId: number;
  jobId: number;
  deploymentId: number;
  runtime: "python" | "node";
  entryFile: string;
  sourceKey: string;
  token: string;
}) {
  const db = await getDb();
  const workDir = path.join(os.tmpdir(), `tbr-bot-${params.botId}`);
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });

  // Write source file
  const source = await storageGet(params.sourceKey);
  await fs.writeFile(path.join(workDir, params.entryFile), source);

  const cmd = params.runtime === "python" ? "python3" : "node";
  const proc = spawn(cmd, [params.entryFile], {
    cwd: workDir,
    env: { ...process.env, TELEGRAM_BOT_TOKEN: params.token },
  });

  const pid = proc.pid ?? 0;
  const runnerJobId = localRunnerJobId(params.botId, pid);
  runningProcesses.set(params.botId, proc);

  async function appendLog(message: string, level: "info" | "error") {
    const db2 = await getDb();
    await db2.insert(botLogs).values({
      botId: params.botId,
      deploymentId: params.deploymentId,
      level,
      message: redactSensitiveText(message.slice(0, 4000)),
    });
  }

  proc.stdout?.on("data", (chunk: Buffer) => appendLog(chunk.toString(), "info").catch(() => null));
  proc.stderr?.on("data", (chunk: Buffer) => appendLog(chunk.toString(), "error").catch(() => null));

  proc.on("exit", async (code) => {
    runningProcesses.delete(params.botId);
    const db3 = await getDb();
    const failed = code !== 0 && code !== null;
    const msg = `Process exited with code ${code ?? "null"}.`;
    await db3.update(bots).set({
      status: failed ? "failed" : "stopped",
      lastError: failed ? msg : null,
      lastStoppedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(bots.id, params.botId));
    await db3.update(runnerJobs).set({
      status: failed ? "failed" : "succeeded",
      error: failed ? msg : null,
      completedAt: new Date(),
    }).where(eq(runnerJobs.id, params.jobId));
    await appendLog(msg, failed ? "error" : "info");
  });

  await db.update(runnerJobs).set({ runnerJobId, status: "processing" }).where(eq(runnerJobs.id, params.jobId));
  return { accepted: true, runnerJobId };
}

export async function localStopBot(params: { botId: number; jobId: number }) {
  const proc = runningProcesses.get(params.botId);
  if (proc) {
    proc.kill("SIGTERM");
    runningProcesses.delete(params.botId);
  }
  const db = await getDb();
  await db.update(runnerJobs).set({ status: "succeeded", completedAt: new Date() }).where(eq(runnerJobs.id, params.jobId));
  await db.update(bots).set({ status: "stopped", desiredState: "stopped", lastStoppedAt: new Date(), updatedAt: new Date() }).where(eq(bots.id, params.botId));
  return { accepted: true };
}
