import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { trpc } from "../lib/trpc.js";

export default function AIProjects() {
  const qc = useQueryClient();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["ai-projects"],
    queryFn: () => trpc.ai.projects.query(),
    refetchInterval: 8000,
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => trpc.ai.providers.query(),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<"python" | "node">("python");
  const [entryFile, setEntryFile] = useState("bot.py");
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState<number | "">("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState("");

  const createMut = useMutation({
    mutationFn: async () => {
      if (!files || files.length === 0) throw new Error("Select at least one source file.");
      if (!providerId) throw new Error("Select an AI provider.");
      const loaded = await Promise.all(
        Array.from(files).map(async (f) => {
          const content = await f.text();
          return { path: f.name, content, byteSize: f.size, isEntry: f.name === entryFile };
        }),
      );
      return trpc.ai.createProject.mutate({ name, runtime, entryFile, prompt: prompt || undefined, providerConfigId: Number(providerId), files: loaded });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-projects"] });
      setShowForm(false);
      setName(""); setPrompt(""); setFiles(null); setError("");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to create project."),
  });

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">AI Conversion Projects</span>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New Project"}</button>
      </div>

      {showForm && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={(e) => { e.preventDefault(); setError(""); createMut.mutate(); }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div className="field">
              <label>Project name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Runtime</label>
              <select value={runtime} onChange={(e) => setRuntime(e.target.value as "python" | "node")}>
                <option value="python">Python</option>
                <option value="node">Node.js</option>
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div className="field">
              <label>Entry file name</label>
              <input value={entryFile} onChange={(e) => setEntryFile(e.target.value)} placeholder="bot.py" required />
            </div>
            <div className="field">
              <label>AI Provider</label>
              <select value={providerId} onChange={(e) => setProviderId(Number(e.target.value))} required>
                <option value="">Select provider…</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.provider})</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Source files (select all)</label>
            <input type="file" multiple onChange={(e) => setFiles(e.target.files)} style={{ padding: "5px 0" }} required />
          </div>
          <div className="field">
            <label>Conversion instruction (optional)</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="e.g. Port from python-telegram-bot v13 to v21" />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? <><span className="spinner" />Converting…</> : "Start Conversion"}
          </button>
          {providers.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--warning)" }}>
              No AI providers configured. Add one in settings (coming soon) or via the API.
            </div>
          )}
        </form>
      )}

      {isLoading && <div style={{ color: "var(--muted)" }}>Loading…</div>}
      {!isLoading && projects.length === 0 && !showForm && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          No conversion projects yet. Click <strong>+ New Project</strong> to convert an existing bot.
        </div>
      )}
      {projects.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead><tr><th>Name</th><th>Runtime</th><th>Status</th><th>Progress</th><th>Updated</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{p.runtime}</td>
                  <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                  <td>
                    <div style={{ background: "var(--border)", borderRadius: 4, height: 6, width: 100 }}>
                      <div style={{ background: "var(--accent)", height: 6, borderRadius: 4, width: `${p.progress}%`, transition: "width 0.4s" }} />
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(p.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
