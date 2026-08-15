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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <form onSubmit={submit} className="card" style={{ width: 320 }}>
        <h2 style={{ marginBottom: 20, fontSize: 18 }}>🤖 Telegram Bot Runner</h2>
        <div className="field">
          <label>Password</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus placeholder="Enter ADMIN_PASSWORD" />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 12 }}>
          {loading ? <><span className="spinner" />Signing in…</> : "Sign in"}
        </button>
      </form>
    </div>
  );
}
