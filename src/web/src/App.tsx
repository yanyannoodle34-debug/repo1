import React from "react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpc } from "./lib/trpc.js";
import BotList from "./pages/BotList.js";
import BotDetail from "./pages/BotDetail.js";
import Upload from "./pages/Upload.js";
import AIProjects from "./pages/AIProjects.js";
import Login from "./pages/Login.js";

const IconBots = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    <circle cx="9" cy="16" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/>
  </svg>
);

const IconUpload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const IconAI = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const NAV = [
  { to: "/bots",   label: "Bots",       Icon: IconBots },
  { to: "/upload", label: "Upload",     Icon: IconUpload },
  { to: "/ai",     label: "AI Convert", Icon: IconAI },
];

function Sidebar({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <div className="sidebar-logo">
        <strong>TBR</strong> Bot Runner
      </div>
      <nav className="sidebar-nav">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="sidebar-logout" onClick={onLogout}>Sign out</button>
      </div>
    </>
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

  if (isLoading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>Loading…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route
          path="/login"
          element={<Login onSuccess={() => { qc.invalidateQueries({ queryKey: ["me"] }); nav("/bots"); }} />}
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <Sidebar onLogout={logout} />
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/bots" replace />} />
          <Route path="/bots" element={<BotList />} />
          <Route path="/bots/:id" element={<BotDetail />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/ai" element={<AIProjects />} />
          <Route path="*" element={<Navigate to="/bots" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
