import crypto from "node:crypto";

export type EncryptedToken = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function encryptionKey() {
  const rawKey = process.env.BOT_TOKEN_ENCRYPTION_KEY ?? "";
  if (rawKey.length < 32) {
    throw new Error("BOT_TOKEN_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  return crypto.createHash("sha256").update(rawKey, "utf8").digest();
}

export function isTokenEncryptionConfigured() {
  return (process.env.BOT_TOKEN_ENCRYPTION_KEY ?? "").length >= 32;
}

export function encryptSecret(secret: string): EncryptedToken {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function encryptTelegramToken(token: string): EncryptedToken {
  return encryptSecret(token);
}

export function decryptSecret(encrypted: EncryptedToken) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptTelegramToken(encrypted: EncryptedToken) {
  return decryptSecret(encrypted);
}

export function redactSensitiveText(value: string) {
  return value.replace(/\b\d{5,20}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TELEGRAM_TOKEN]");
}

export function redactProviderKey(value: string) {
  if (value.length <= 8) return "[REDACTED_PROVIDER_KEY]";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function isPlausibleProviderKey(key: string) {
  return /^[A-Za-z0-9_\-\.]{12,256}$/.test(key);
}

export function isPlausibleTelegramToken(token: string) {
  return /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(token);
}
