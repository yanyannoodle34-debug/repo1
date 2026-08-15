import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import cookieParser from "cookie-parser";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth.js";
import { registerStorageProxy } from "./storageProxy.js";
import { appRouter } from "../routers/index.js";
import { handleRunnerReport } from "./runner-report.js";
import { createContext } from "./context.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => { server.close(() => resolve(true)); });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => { res.json({ ok: true, timestamp: Date.now() }); });
  app.post("/api/runner/report", handleRunnerReport);

  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  // Serve built web dashboard in production
  const webDist = path.resolve(__dirname, "../../dist/web");
  if (process.env.NODE_ENV === "production" && fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("*", (_req, res) => { res.sendFile(path.join(webDist, "index.html")); });
  }

  const preferredPort = parseInt(process.env.PORT ?? "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) console.log(`Port ${preferredPort} is busy, using port ${port} instead`);

  server.listen(port, () => { console.log(`[api] server listening on http://localhost:${port}`); });
}

startServer().catch(console.error);
