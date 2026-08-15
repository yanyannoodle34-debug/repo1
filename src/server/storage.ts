import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function storageDir() {
  return process.env.STORAGE_DIR
    ? process.env.STORAGE_DIR.replace(/^~/, os.homedir())
    : path.join(os.homedir(), ".tbr", "storage");
}

function signingSecret() {
  return process.env.SESSION_SECRET ?? "insecure-dev-secret";
}

function signKey(key: string) {
  return crypto.createHmac("sha256", signingSecret()).update(key).digest("hex");
}

export async function storagePut(key: string, data: Buffer, _contentType: string) {
  const fullPath = path.join(storageDir(), key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, data);
  return { key };
}

export async function storageGet(key: string) {
  return fs.readFile(path.join(storageDir(), key));
}

export async function storageGetSignedUrl(key: string) {
  const sig = signKey(key);
  const encoded = Buffer.from(key).toString("base64url");
  return `/api/storage/${sig}/${encoded}`;
}

export function storageVerifySignedUrl(sig: string, encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64url").toString("utf8");
  const expected = signKey(key);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return key;
}

export function storageFullPath(key: string) {
  return path.join(storageDir(), key);
}
