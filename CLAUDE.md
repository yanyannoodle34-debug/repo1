# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A self-hosted Telegram Bot Runner. Users upload Python or Node.js bots via a local web dashboard; the server stores source files on the local filesystem, manages a SQLite database, and spawns the bots as child processes. It also includes an AI-powered code conversion feature (chunk-based LLM rewriting via DeepSeek or NVIDIA NIM).

Designed to run on Android Termux or any Linux machine — no cloud dependencies by default.

## Commands

```bash
npm run dev          # Start API server with hot-reload (tsx watch)
npm run dev:web      # Start Vite web dashboard dev server on :5173
npm run build        # tsc + vite build → dist/server + dist/web
NODE_ENV=production npm start   # Serve API + built dashboard from one port

npm run db:push      # Push schema to SQLite (creates ~/.tbr/db.sqlite)
npm run db:studio    # Open Drizzle Studio in browser

npm test             # Run Vitest unit tests
npx vitest run src/tests/aiconversion.test.ts   # Run a single test file
```

First-time setup:
```bash
cp .env.example .env   # then edit with your secrets
npm install
npm run db:push
npm run build
NODE_ENV=production npm start
```

Termux-specific bootstrap: `bash termux-setup.sh`

## Architecture

### Data flow

```
Browser (React + tRPC client)
  → GET/POST /api/trpc    Express + @trpc/server
  → GET/POST /auth/*      Local password auth (cookie session)
  → GET /api/storage/*    HMAC-signed local file serving
```

### Key architectural decisions

**Database**: Drizzle ORM over SQLite (`better-sqlite3`). Schema is in `src/drizzle/schema.ts` — all MySQL column types are ported to SQLite equivalents (`text`, `integer`, `integer({ mode: 'timestamp_ms' })`). `getDb()` in `src/server/db.ts` returns a cached drizzle instance; it's always available (never null).

**Storage**: Local filesystem at `~/.tbr/storage/` (or `$STORAGE_DIR`). `storagePut` / `storageGetSignedUrl` in `src/server/storage.ts`. Signed URLs use HMAC-SHA256 with `SESSION_SECRET`; the `storageProxy.ts` middleware validates and serves them.

**Auth**: Single-user, password-based. `POST /auth/login` compares against `ADMIN_PASSWORD` env var, creates/finds a user row with `openId = "local"`, sets an HMAC-signed session cookie. The tRPC `protectedProcedure` in `src/server/_core/trpc.ts` rejects unauthenticated requests.

**Bot runner**: When `BOT_RUNNER_URL` is not set (the default), `dispatchRunnerAction` in `src/server/runner.ts` calls `localStartBot` / `localStopBot` from `src/server/local-runner.ts`, which spawns Python/Node child processes and pipes stdout/stderr to `botLogs`. If `BOT_RUNNER_URL` is set, it delegates to that external HTTP service instead.

**Bot token encryption**: Telegram tokens and AI provider API keys are encrypted at rest with AES-256-GCM using `BOT_TOKEN_ENCRYPTION_KEY`. See `src/server/bot-security.ts`.

**AI conversion**: `src/server/ai-conversion.ts` splits source files into 120-line chunks, converts each chunk via an OpenAI-compatible LLM, and reassembles. Supported providers: DeepSeek, NVIDIA NIM.

### Project layout

```
src/
  server/
    index.ts          Express entry point
    _core/            tRPC setup, cookies, system router
    db.ts             SQLite connection (getDb)
    db-helpers.ts     Reusable query helpers (getBotForUser, etc.)
    storage.ts        Local FS storage + HMAC URL signing
    storageProxy.ts   Express route that serves signed storage URLs
    oauth.ts          Local password auth routes
    context.ts        tRPC context factory (resolves user from cookie)
    runner.ts         Bot lifecycle dispatcher (external or local)
    local-runner.ts   Child-process bot runner
    runner-report.ts  Webhook handler for external runner callbacks
    bot-security.ts   AES-256-GCM encrypt/decrypt for secrets
    ai-provider.ts    OpenAI-compatible LLM client
    ai-conversion.ts  Chunk-based AI code conversion pipeline
  drizzle/
    schema.ts         All table definitions (SQLite)
  routers/
    index.ts          Full tRPC appRouter (auth, bot, ai)
    db.ts             Re-exports from server/db.ts and db-helpers.ts
  shared/
    const.ts          COOKIE_NAME, SESSION_TTL_MS
    examplebot.ts     Example bot template for UI display
  web/
    index.html
    vite.config.ts    Proxies /api and /auth to :3000 in dev
    src/
      main.tsx        React entry
      App.tsx         Router + NavBar + auth gate
      index.css       Design tokens + utility classes
      lib/trpc.ts     tRPC proxy client
      pages/
        Login.tsx
        BotList.tsx
        BotDetail.tsx
        Upload.tsx
        AIProjects.tsx
  tests/
    aiconversion.test.ts
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Dashboard login password |
| `SESSION_SECRET` | yes | HMAC key for session cookies and storage URLs (≥32 chars) |
| `BOT_TOKEN_ENCRYPTION_KEY` | yes | AES key for Telegram tokens (≥32 chars) |
| `PORT` | no | Server port (default 3000) |
| `DB_PATH` | no | SQLite file path (default `~/.tbr/db.sqlite`) |
| `STORAGE_DIR` | no | File storage directory (default `~/.tbr/storage`) |
| `BOT_RUNNER_URL` | no | External runner base URL; leave blank for local process runner |
| `BOT_RUNNER_API_KEY` | no | API key for external runner |
| `BOT_RUNNER_CALLBACK_URL` | no | Public URL the external runner calls back to |

## Conventions

- All DB mutations that involve `updatedAt` must set it manually: `.set({ ..., updatedAt: new Date() })` — SQLite has no `onUpdateNow()`.
- Drizzle `insert().returning()` is used to get inserted row IDs; use `inserted[0].id` (not `insertId`).
- `onConflictDoNothing()` is used for idempotent inserts (e.g. conversion dependencies).
- Telegram tokens in logs are redacted via `redactSensitiveText()` before any DB write.
- The `protectedProcedure` context has `user` typed as non-null; call sites don't need null checks.
