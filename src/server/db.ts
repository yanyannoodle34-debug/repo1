import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import * as schema from "../drizzle/schema.js";
import path from "path";
import os from "os";
import fs from "fs";

function openDb() {
  const dbPath = process.env.DB_PATH ?? path.join(os.homedir(), ".tbr", "db.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

let _db: ReturnType<typeof openDb> | null = null;

export function getDb() {
  if (!_db) _db = openDb();
  return Promise.resolve(_db);
}

export type Db = ReturnType<typeof openDb>;
