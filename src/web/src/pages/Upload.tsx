import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.js";

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export default function Upload() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<"python" | "node">("python");
  const [token, setToken] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [reqFile, setReqFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      if (!sourceFile || !reqFile) throw new Error("Select both files.");
      const [sourceb64, reqb64] = await Promise.all([fileToBase64(sourceFile), fileToBase64(reqFile)]);
      return trpc.bot.upload.mutate({
        name,
        runtime,
        token,
        source: { name: sourceFile.name, base64: sourceb64, size: sourceFile.size },
        requirements: { name: reqFile.name, base64: reqb64, size: reqFile.size },
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["bots"] });
      nav(`/bots/${data.botId}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Upload failed."),
  });

  const pythonHints = { entry: ".py file (e.g. bot.py)", req: "requirements.txt" };
  const nodeHints = { entry: ".js / .ts entry file (e.g. index.js)", req: "package.json" };
  const hints = runtime === "python" ? pythonHints : nodeHints;

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="page-header"><span className="page-title">Upload Bot</span></div>
      <form onSubmit={(e) => { e.preventDefault(); setError(""); mut.mutate(); }} className="card">
        <div className="field">
          <label>Bot name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Bot" required />
        </div>
        <div className="field">
          <label>Runtime</label>
          <select value={runtime} onChange={(e) => setRuntime(e.target.value as "python" | "node")}>
            <option value="python">Python</option>
            <option value="node">Node.js</option>
          </select>
        </div>
        <div className="field">
          <label>Source file — {hints.entry}</label>
          <input type="file" onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)} accept={runtime === "python" ? ".py" : ".js,.ts,.mjs,.cjs"} required style={{ padding: "5px 0" }} />
        </div>
        <div className="field">
          <label>Dependencies — {hints.req}</label>
          <input type="file" onChange={(e) => setReqFile(e.target.files?.[0] ?? null)} accept={runtime === "python" ? ".txt" : ".json"} required style={{ padding: "5px 0" }} />
        </div>
        <div className="field">
          <label>Telegram bot token</label>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AABB…" required />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <button type="submit" disabled={mut.isPending} style={{ width: "100%", marginTop: 8 }}>
          {mut.isPending ? <><span className="spinner" />Uploading…</> : "Upload"}
        </button>
      </form>
    </div>
  );
}
