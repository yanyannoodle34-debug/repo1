import type { Request } from "express";
import { SESSION_TTL_MS } from "../../shared/const.js";

export function getSessionCookieOptions(req: Request) {
  const secure = req.get("x-forwarded-proto") === "https" || req.protocol === "https";
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  };
}
