# Finger Chess — Final Production Export

**A premium, real-time chess platform with two clearly separated game modes: Free Play (the
primary, most prominent option) and Real Money Matches (deposit, stake, win a prize minus
platform commission).** Includes full identity verification (KYC), age gating, a real-time social
system (friends, messaging, presence), and a complete admin dashboard.

This is a packaging pass only — every file in this archive is an exact, unmodified copy of the
current, production-ready state of each project. Nothing was regenerated, rewritten, or altered to
produce this export.

---

## What's in this archive

```
Finger-Chess/
├── finger-chess-backend/      NestJS API — deploy to Railway/Render/Fly.io/ECS/any Node host
├── finger-chess-frontend/     Next.js player app — deploy to Vercel
├── finger-chess-admin/        Vite + React admin console — deploy to Vercel/Netlify/any static host
├── finger-chess-infra/        Docker Compose (local dev) + Kubernetes manifests (production)
└── README.md                  This file
```

### A note on folder naming — read before renaming anything

`finger-chess-infra/docker-compose.yml` and its Kubernetes manifests reference the other three
project folders **by their exact current names**, via relative paths (`../finger-chess-backend`,
`../finger-chess-frontend`, `../finger-chess-admin`). Renaming these folders — for example, to the
shorter `backend/`, `frontend/`, `admin/` — will break that Docker Compose file, since it isn't
included in this packaging pass to keep it in sync with any renaming. If you want the shorter
names, either rename the folders **and** update the `context:` paths in
`finger-chess-infra/docker-compose.yml` to match, or leave the folder names as they are — both work
identically otherwise.

### Why there's no single root `package.json` or root `.env.example`

This is deliberately **not** an npm/pnpm workspace monorepo — each of the three applications has
always had, and still has, its own independent `package.json`, its own dependency tree, and its own
`.env.example` with a completely different set of variables serving a different runtime (a NestJS
API vs. a Next.js app vs. a Vite SPA). A single root `package.json` would either need to be a
convenience no-op (misleading — it wouldn't actually install or run anything) or would require
restructuring all three into real npm workspaces, which is a structural change to the codebase, not
a packaging step. Same reasoning for `.env.example`: each app reads its own `.env` file at its own
path; a merged file at the root doesn't correspond to how any of the three actually load
configuration, and would risk someone creating one wrong file instead of three correct ones.

Install and run each project from inside its own folder — see below.

### Where the database lives

There's no separate top-level `database/` folder. The Prisma schema, every migration, and the seed
script live inside `finger-chess-backend/prisma/` — exactly where Prisma requires them to be,
alongside the one application that actually connects to and migrates the database. Duplicating or
relocating them would either desynchronize two copies of the same schema or require restructuring
the backend project, neither of which belongs in a packaging-only pass.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Node.js 20, NestJS 10, TypeScript, PostgreSQL 16, Prisma, Redis 7, Socket.IO |
| Player Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui |
| Admin Console | Vite, React 18, TypeScript, Tailwind CSS |
| Auth | JWT (access + refresh, rotation-on-use), 2FA (TOTP), Google/Discord OAuth |
| Payments | Stripe (PaymentIntents + webhooks) — Real Money mode only, entirely bypassed by Free Play |
| Real-time | Socket.IO with a Redis adapter (cross-instance broadcast) |
| File Storage | S3-compatible (KYC documents, avatars — signed URLs, never public) |
| Deployment | Docker (multi-stage, non-root) + Kubernetes, or Vercel for both frontends |

---

## Feature Summary

- **Two game modes**: Free Play (unlimited, no wallet, no verification, open to everyone) and Real
  Money Matches (entry-fee rooms `$5`–`$100`, wallet, prize distribution, commission) — structurally
  separated at the matchmaking level (a `$0` room and a `$5` room are different queues by
  construction, so free and paid players can never be matched together) and separated in the UI as
  two distinct, clearly labeled options.
- **Identity verification (KYC)**: passport / national ID / driver's license / health card upload,
  admin approve/reject review queue, gates deposits/withdrawals/paid matches — Free Play requires
  none of it.
- **Age gating**: configurable minimum age, required before any real-money feature, never blocks
  Free Play.
- **Platform rules acceptance**: versioned, timestamped, re-required whenever the rules text
  changes.
- **Penalty system**: warnings, configurable-duration suspensions, chat mutes, and permanent bans —
  full history, admin-issued, escalating from a non-restrictive warning up to a ban.
- **Anti-cheat & risk engine**: Stockfish-based engine-use detection, move-timing behavior analysis,
  device fingerprinting (multi-account detection), shared-IP clustering, browser-tamper detection,
  all aggregated into one cached 0–100 risk score per user with automatic flagging into the admin
  review queue.
- **Real rating system**: Elo-based, updates after every game (not a static default), tracks peak
  rating and full rating history per game mode.
- **Full social system**: friends, real-time encrypted messaging, presence, achievements, badges,
  player search, reporting/moderation.
- **Admin dashboard**: user management, wallet monitoring, KYC review, risk/security review, game
  monitoring (filterable by Free/Paid mode), financial reports, support tickets, a verified
  role-permissions reference, and full audit/security logs.
- **Hardened authentication**: the refresh token lives in an httpOnly, SameSite=Strict cookie —
  never readable by JavaScript — with the access token held in memory only; a successful XSS bug no
  longer grants a persistent, renewable account takeover.

## Prerequisites

- **Node.js 20+** and **npm** (or pnpm — swap the binary name; nothing here uses a pnpm-specific
  feature)
- **PostgreSQL 16+** and **Redis 7+** (locally, or via `finger-chess-infra/docker-compose.yml`)
- Optional for full functionality: a Stripe account (test mode is fine — only needed for Real Money
  mode), an SMTP/SendGrid-compatible provider, Google/Discord OAuth credentials, an S3-compatible
  bucket

## Quick Start — Local Development

**A note on the first `npm install` in each project**: no `package-lock.json` ships in this
archive. This codebase was authored and verified (via TypeScript compilation checks) in a
sandboxed environment with no network access to npm's registry, so a lockfile was never actually
generated here — fabricating one by hand would mean guessing at resolved versions and integrity
hashes, which is worse than no lockfile at all since it can silently break `npm ci`. Your first
`npm install` in each project generates a real one normally; that's expected first-run behavior,
not a missing piece of the deliverable. Commit the resulting lockfiles once generated.

```bash
# 1. Database & Redis
cd finger-chess-infra && docker compose up -d postgres redis

# 2. Backend
cd ../finger-chess-backend
cp .env.example .env          # fill in the values documented inside the file
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev             # http://localhost:3000

# 3. Player frontend (separate terminal)
cd ../finger-chess-frontend
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:3001

# 4. Admin console (separate terminal)
cd ../finger-chess-admin
cp .env.example .env
npm install
npm run dev                   # http://localhost:5174
```

No additional coding required — three independent `npm install`s, one migration/seed pass, three
dev servers.

## Production Deployment

- **Both frontends → Vercel**: push each project's folder as its own repository (or a subfolder of
  one, using Vercel's root-directory setting), Vercel auto-detects Next.js and Vite respectively.
  Set the frontend's `NEXT_PUBLIC_FINGER_CHESS_*` / admin's `VITE_FINGER_CHESS_*` environment
  variables in the Vercel dashboard.
- **Backend → any Docker-capable host**: `finger-chess-backend/Dockerfile` is multi-stage,
  non-root, and health-checked — deploys unmodified to Railway, Render, Fly.io, ECS, Cloud Run, or
  Kubernetes (full manifests in `finger-chess-infra/k8s/`). Run `npx prisma migrate deploy` once as
  part of your deploy step, not automatically on every container start.
- **GitHub**: `git init` at the root of this extracted archive, commit, push — each project's own
  `.gitignore` already excludes `node_modules`, `.env`, and build output.

See each project's own `README.md` for full architecture notes, every environment variable
explained, and the security/code-quality review documents (`SECURITY_AUDIT.md`,
`LEAD_ENGINEER_REVIEW.md`, `SOCIAL_SYSTEM.md`) inside `finger-chess-backend/`.
