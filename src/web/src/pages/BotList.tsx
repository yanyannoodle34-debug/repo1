import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { trpc } from "../lib/trpc.js";

function statusBadge(status: string) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export default function BotList() {
  const qc = useQueryClient();
  const { data: bots = [], isLoading } = useQuery({
    queryKey: ["bots"],
    queryFn: () => trpc.bot.list.query(),
    refetchInterval: 5000,
  });

  const startMut = useMutation({
    mutationFn: (botId: number) => trpc.bot.start.mutate({ botId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });
  const stopMut = useMutation({
    mutationFn: (botId: number) => trpc.bot.stop.mutate({ botId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">Your Bots</span>
        <Link to="/upload"><button>+ Upload Bot</button></Link>
      </div>

      {isLoading && <div style={{ color: "var(--muted)" }}>Loading…</div>}

      {!isLoading && bots.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          No bots yet. <Link to="/upload">Upload your first bot</Link>.
        </div>
      )}

      {bots.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Runtime</th>
                <th>Status</th>
                <th>Last started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bots.map((bot) => {
                const canStart = ["stopped", "failed", "draft"].includes(bot.status);
                const canStop = ["running", "starting"].includes(bot.status);
                return (
                  <tr key={bot.id}>
                    <td><Link to={`/bots/${bot.id}`} style={{ fontWeight: 500 }}>{bot.name}</Link></td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{bot.runtime}</td>
                    <td>{statusBadge(bot.status)}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {bot.lastStartedAt ? new Date(bot.lastStartedAt).toLocaleString() : "—"}
                    </td>
                    <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {canStart && (
                        <button className="sm" disabled={startMut.isPending} onClick={() => startMut.mutate(bot.id)}>Start</button>
                      )}
                      {canStop && (
                        <button className="sm danger" disabled={stopMut.isPending} onClick={() => stopMut.mutate(bot.id)}>Stop</button>
                      )}
                      <Link to={`/bots/${bot.id}`}><button className="ghost sm">Logs</button></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
