import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.js";

export default function BotDetail() {
  const { id } = useParams<{ id: string }>();
  const botId = parseInt(id ?? "0");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["bot", botId],
    queryFn: () => trpc.bot.detail.query({ botId }),
    refetchInterval: 4000,
  });

  const startMut = useMutation({
    mutationFn: () => trpc.bot.start.mutate({ botId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot", botId] }),
  });
  const stopMut = useMutation({
    mutationFn: () => trpc.bot.stop.mutate({ botId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot", botId] }),
  });

  if (isLoading) return <div className="page" style={{ color: "var(--muted)" }}>Loading…</div>;
  if (!data) return <div className="page"><Link to="/bots">← Back</Link> <br /><br />Bot not found.</div>;

  const { bot, deployment, logs, jobs } = data;
  const canStart = ["stopped", "failed", "draft"].includes(bot.status);
  const canStop = ["running", "starting"].includes(bot.status);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/bots" style={{ fontSize: 12, color: "var(--muted)" }}>← All bots</Link>
          <h1 className="page-title" style={{ marginTop: 4 }}>{bot.name}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canStart && <button disabled={startMut.isPending} onClick={() => startMut.mutate()}>▶ Start</button>}
          {canStop && <button className="danger" disabled={stopMut.isPending} onClick={() => stopMut.mutate()}>■ Stop</button>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div className="card">
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 10 }}>Bot Info</div>
          {[
            ["Status", <span className={`badge ${bot.status}`}>{bot.status}</span>],
            ["Runtime", bot.runtime],
            ["Entry file", bot.entryFile],
            ["Desired state", bot.desiredState],
          ].map(([k, v]) => (
            <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {bot.lastError && (
            <div style={{ marginTop: 8, background: "#2a1010", border: "1px solid #5a2020", borderRadius: 6, padding: "6px 10px", fontSize: 12, color: "var(--danger)" }}>
              {bot.lastError}
            </div>
          )}
        </div>
        <div className="card">
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 10 }}>Deployment</div>
          {deployment ? (
            [
              ["Status", <span className={`badge ${deployment.status}`}>{deployment.status}</span>],
              ["Created", new Date(deployment.createdAt).toLocaleString()],
            ].map(([k, v]) => (
              <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: "var(--muted)" }}>{k}</span>
                <span>{v}</span>
              </div>
            ))
          ) : (
            <span style={{ color: "var(--muted)" }}>No deployment yet.</span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Logs</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>latest {logs.length}</span>
        </div>
        <div className="log-block">
          {logs.length === 0 && <span style={{ color: "var(--muted)" }}>No logs yet.</span>}
          {[...logs].reverse().map((log) => (
            <div key={log.id} className={`log-line ${log.level}`}>
              <span className="log-ts">{new Date(log.createdAt).toLocaleTimeString()}</span>
              {log.message}
            </div>
          ))}
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="card">
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 10 }}>Runner Jobs</div>
          <table>
            <thead><tr><th>Action</th><th>Status</th><th>Requested</th><th>Error</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td style={{ textTransform: "capitalize" }}>{j.action}</td>
                  <td><span className={`badge ${j.status}`}>{j.status}</span></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(j.requestedAt).toLocaleString()}</td>
                  <td style={{ fontSize: 12, color: "var(--danger)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
