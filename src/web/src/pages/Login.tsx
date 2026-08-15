import React, { useState } from "react";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
        credentials: "include",
      });
      if (!res.ok) { setError((await res.json() as { error?: string }).error ?? "Login failed."); return; }
      onSuccess();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 16 }}>
      <form onSubmit={submit} className="card" style={{ width: 340 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px", color: "var(--text)", marginBottom: 4 }}>
            Telegram Bot Runner
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Sign in to manage your bots</div>
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            placeholder="Enter ADMIN_PASSWORD"
          />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 14 }}>
          {loading ? <><span className="spinner" />Signing in…</> : "Sign in"}
        </button>
      </form>
    </div>
  );
}
