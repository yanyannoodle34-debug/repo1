import type { Express } from "express";
import { storageVerifySignedUrl, storageFullPath } from "./storage.js";
import fs from "node:fs";

export function registerStorageProxy(app: Express) {
  app.get("/api/storage/:sig/:encodedKey", (req, res) => {
    const key = storageVerifySignedUrl(req.params.sig, req.params.encodedKey);
    if (!key) {
      res.status(403).json({ error: "Invalid or expired storage URL." });
      return;
    }
    const filePath = storageFullPath(key);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    res.sendFile(filePath);
  });
}
