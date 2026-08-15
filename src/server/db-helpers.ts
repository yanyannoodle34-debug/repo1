import { and, desc, eq } from "drizzle-orm";
import { botLogs, bots, deployments, runnerJobs } from "../drizzle/schema.js";
import { getDb } from "./db.js";

export async function getBotForUser(botId: number, userId: number) {
  const db = await getDb();
  return (await db.select().from(bots).where(and(eq(bots.id, botId), eq(bots.userId, userId))).limit(1))[0] ?? null;
}

export async function getLatestDeployment(botId: number) {
  const db = await getDb();
  return (await db.select().from(deployments).where(eq(deployments.botId, botId)).orderBy(desc(deployments.createdAt)).limit(1))[0] ?? null;
}

export async function listBotsForUser(userId: number) {
  const db = await getDb();
  return db.select().from(bots).where(eq(bots.userId, userId)).orderBy(desc(bots.updatedAt));
}

export async function listBotLogsForUser(botId: number, userId: number) {
  const db = await getDb();
  const bot = (await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), eq(bots.userId, userId))).limit(1))[0];
  if (!bot) return null;
  return db.select().from(botLogs).where(eq(botLogs.botId, botId)).orderBy(desc(botLogs.createdAt)).limit(200);
}

export async function listRunnerJobs(botId: number) {
  const db = await getDb();
  return db.select().from(runnerJobs).where(eq(runnerJobs.botId, botId)).orderBy(desc(runnerJobs.requestedAt)).limit(20);
}
