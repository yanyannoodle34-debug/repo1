import type { Express } from "express";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { COOKIE_NAME } from "../shared/const.js";
import crypto from "node:crypto";

function signSession(userId: number): string {
  const secret = process.env.SESSION_SECRET ?? "insecure-dev-secret";
  const payload = `${userId}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(cookie: string): number | null {
  const secret = process.env.SESSION_SECRET ?? "insecure-dev-secret";
  const dot = cookie.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const id = parseInt(payload, 10);
  return isNaN(id) ? null : id;
}

export function registerOAuthRoutes(app: Express) {
  app.post("/auth/login", async (req, res) => {
    const { password } = req.body as { password?: string };
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";
    if (!adminPassword || !password) {
      res.status(400).json({ error: "Missing password." });
      return;
    }
    const passwordBuf = Buffer.from(password);
    const adminBuf = Buffer.from(adminPassword);
    const match =
      passwordBuf.length === adminBuf.length &&
      crypto.timingSafeEqual(passwordBuf, adminBuf);
    if (!match) {
      res.status(401).json({ error: "Invalid password." });
      return;
    }
    const db = await getDb();
    let user = (await db.select().from(users).where(eq(users.openId, "local")).limit(1))[0];
    if (!user) {
      const inserted = await db.insert(users).values({ openId: "local", name: "Admin", loginMethod: "password" }).returning();
      user = inserted[0];
    } else {
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.openId, "local"));
    }
    const token = signSession(user.id);
    res.cookie(COOKIE_NAME, token, getSessionCookieOptions(req));
    res.json({ ok: true });
  });

  app.get("/auth/me", async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (!token) { res.json(null); return; }
    const userId = verifySession(token);
    if (!userId) { res.json(null); return; }
    const db = await getDb();
    const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0] ?? null;
    res.json(user);
  });

  app.post("/auth/logout", (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });
}
