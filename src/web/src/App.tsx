import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc } from "./lib/trpc.js";
import BotList from "./pages/BotList.js";
import BotDetail from "./pages/BotDetail.js";
import Upload from "./pages/Upload.js";
import AIProjects from "./pages/AIProjects.js";
import Login from "./pages/Login.js";

function NavBar({ onLogout }: { onLogout: () => void }) {
  return (
    <nav style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "0 16px", display: "flex", alignItems: "center", gap: 24, height: 48 }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginRight: 8 }}>🤖 TBR</span>
      {[
        { to: "/bots", label: "Bots" },
        { to: "/upload", label: "Upload" },
        { to: "/ai", label: "AI Convert" },
      ].map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          style={({ isActive }) => ({ color: isActive ? "var(--accent)" : "var(--muted)", fontWeight: isActive ? 600 : 400, fontSize: 13 })}
        >
          {label}
        </NavLink>
      ))}
      <button className="ghost sm" style={{ marginLeft: "auto" }} onClick={onLogout}>Logout</button>
    </nav>
  );
}

function AppInner() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: user, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => trpc.auth.me.query(),
  });

  async function logout() {
    await trpc.auth.logout.mutate();
    qc.clear();
    nav("/login");
  }

  if (isLoading) return <div style={{ padding: 32, color: "var(--muted)" }}>Loading…</div>;
  if (!user) return (
    <Routes>
      <Route path="/login" element={<Login onSuccess={() => { qc.invalidateQueries({ queryKey: ["me"] }); nav("/bots"); }} />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );

  return (
    <>
      <NavBar onLogout={logout} />
      <Routes>
        <Route path="/" element={<Navigate to="/bots" replace />} />
        <Route path="/bots" element={<BotList />} />
        <Route path="/bots/:id" element={<BotDetail />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/ai" element={<AIProjects />} />
        <Route path="*" element={<Navigate to="/bots" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
