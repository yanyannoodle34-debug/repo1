import type { Request, Response } from "express";
import { processRunnerReport } from "./runner.js";
import { isRunnerAuthorized } from "./runner.js";

export async function handleRunnerReport(req: Request, res: Response) {
  if (!isRunnerAuthorized(req.headers.authorization)) {
    res.status(401).json({ error: "Runner authentication failed." });
    return;
  }
  try {
    const result = await processRunnerReport(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Runner report failed." });
  }
}
