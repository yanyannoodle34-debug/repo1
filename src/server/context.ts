import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { verifySession } from "./oauth.js";
import { COOKIE_NAME } from "../shared/const.js";
import type { User } from "../drizzle/schema.js";

export type Context = {
  req: Request;
  res: Response;
  user: User | null;
};

export async function createContext({ req, res }: { req: Request; res: Response }): Promise<Context> {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) return { req, res, user: null };
  const userId = verifySession(token);
  if (!userId) return { req, res, user: null };
  const db = await getDb();
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0] ?? null;
  return { req, res, user };
}
