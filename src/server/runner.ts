import { storageGetSignedUrl } from "./storage.js";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { decryptTelegramToken, redactSensitiveText } from "./bot-security.js";
import { botLogs, bots, runnerJobs, type Bot, type Deployment, type RunnerAction } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { localStartBot, localStopBot } from "./local-runner.js";

export type RunnerDispatchResult = {
  accepted: boolean;
  runnerJobId?: string;
  error?: string;
};

function runnerConfiguration() {
  const url = (process.env.BOT_RUNNER_URL ?? "").replace(/\/+$/, "");
  const apiKey = process.env.BOT_RUNNER_API_KEY ?? "";
  return { url, apiKey, configured: Boolean(url && apiKey) };
}

export function isRunnerConfigured() {
  return true; // local runner is always available
}

export function isRunnerAuthorized(authorizationHeader?: string) {
  const expected = process.env.BOT_RUNNER_API_KEY ?? "";
  if (!expected) return false;
  const provided = authorizationHeader?.replace(/^Bearer\s+/i, "") ?? "";
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export type RunnerReport = {
  jobId: number;
  status: "succeeded" | "failed";
  runnerJobId?: string;
  error?: string;
  logLine?: string;
};

export async function processRunnerReport(input: RunnerReport) {
  const db = await getDb();
  const job = (await db.select().from(runnerJobs).where(eq(runnerJobs.id, input.jobId)).limit(1))[0];
  if (!job) throw new Error("Runner job not found.");
  const bot = (await db.select().from(bots).where(eq(bots.id, job.botId)).limit(1))[0];
  if (!bot) throw new Error("Bot not found.");
  const nextStatus = input.status === "succeeded" ? (job.action === "stop" ? "stopped" : "running") : "failed";
  await db.transaction(async (tx) => {
    await tx.update(runnerJobs).set({
      status: input.status,
      runnerJobId: input.runnerJobId,
      error: input.error ? redactSensitiveText(input.error) : null,
      completedAt: new Date(),
    }).where(eq(runnerJobs.id, job.id));
    await tx.update(bots).set({
      status: nextStatus,
      runnerId: input.runnerJobId ?? bot.runnerId,
      lastError: input.status === "failed" ? redactSensitiveText(input.error ?? "Runner reported a failure.") : null,
      lastHeartbeatAt: new Date(),
      lastStartedAt: nextStatus === "running" ? new Date() : bot.lastStartedAt,
      lastStoppedAt: nextStatus === "stopped" ? new Date() : bot.lastStoppedAt,
      updatedAt: new Date(),
    }).where(eq(bots.id, bot.id));
    if (input.logLine) {
      await tx.insert(botLogs).values({
        botId: bot.id,
        deploymentId: job.deploymentId,
        level: input.status === "failed" ? "error" : "info",
        message: redactSensitiveText(input.logLine),
      });
    }
  });
  return { ok: true };
}

export async function dispatchRunnerAction(input: {
  action: RunnerAction;
  bot: Bot;
  deployment: Deployment;
  jobId: number;
  callbackUrl?: string;
}): Promise<RunnerDispatchResult> {
  const configuration = runnerConfiguration();

  // Use external runner when configured
  if (configuration.configured) {
    try {
      const [sourceUrl, requirementsUrl] = await Promise.all([
        storageGetSignedUrl(input.bot.sourceKey),
        storageGetSignedUrl(input.bot.requirementsKey),
      ]);
      const token = decryptTelegramToken({
        ciphertext: input.bot.tokenCiphertext,
        iv: input.bot.tokenIv,
        authTag: input.bot.tokenAuthTag,
      });
      const response = await fetch(`${configuration.url}/jobs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${configuration.apiKey}`,
        },
        body: JSON.stringify({
          action: input.action,
          botId: input.bot.id,
          deploymentId: input.deployment.id,
          jobId: input.jobId,
          runtime: input.bot.runtime,
          entryFile: input.bot.entryFile,
          sourceUrl,
          requirementsUrl,
          token,
          callbackUrl: input.callbackUrl,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { accepted: false, error: `Runner rejected the request (${response.status}).` };
      const payload = (await response.json().catch(() => ({}))) as { jobId?: string };
      return { accepted: true, runnerJobId: payload.jobId };
    } catch {
      return { accepted: false, error: "Unable to reach the configured runner." };
    }
  }

  // Fallback: local child-process runner
  const token = decryptTelegramToken({
    ciphertext: input.bot.tokenCiphertext,
    iv: input.bot.tokenIv,
    authTag: input.bot.tokenAuthTag,
  });

  if (input.action === "start" || input.action === "deploy") {
    return localStartBot({
      botId: input.bot.id,
      jobId: input.jobId,
      deploymentId: input.deployment.id,
      runtime: input.bot.runtime,
      entryFile: input.bot.entryFile,
      sourceKey: input.bot.sourceKey,
      token,
    });
  }

  if (input.action === "stop") {
    return localStopBot({ botId: input.bot.id, jobId: input.jobId });
  }

  return { accepted: false, error: `Unsupported action: ${input.action}` };
}
