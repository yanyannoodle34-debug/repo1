import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import path from "path";
import os from "os";

const dbPath = process.env.DB_PATH ?? path.join(os.homedir(), ".tbr", "db.sqlite");

export default defineConfig({
  schema: "./src/drizzle/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: dbPath },
});
