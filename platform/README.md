# PFG Platform

The real application behind participantsforgood.org: passwordless sign-in, participant
onboarding and dashboard, and the money ledger. Server-rendered HTML on Express with
SQLite; no build step.

## Run it

```bash
cd platform
npm install
npm run dev        # http://localhost:4519
```

With no `.env`, the app runs in **dev mode**: magic links appear on-screen instead of
being emailed, and a dev-only "complete session" route exists so the ledger flow can be
exercised before the admin console is built. Copy `.env.example` to `.env` for
production settings.

## Architecture

| Piece | Choice | Why |
|---|---|---|
| Server | Express 5, server-rendered HTML | Five routes today; smallest thing a future volunteer dev can read in one sitting |
| Database | SQLite (better-sqlite3), WAL mode | Zero-ops, fits Railway volume, trivially backed up; Postgres migration is a rainy-day task, not a prerequisite |
| Auth | Email magic links, 15-min single-use tokens, 30-day httpOnly session cookies | Passwordless suits participants; no credentials to breach |
| Email | Resend (env-gated) | Unset key = dev mode with on-screen links |
| Money | `ledger` table, amounts in cents, one row per incentive/contribution | The traceability spine from docs/PLATFORM-PLAN.md, in from day one |
| Styling | `public/app.css`, copied from the prototype's design system | The prototype was the design spec; `PFG.hearts()` and toasts come along |

### Data model

`users` → `profiles` (self-reported demographics, all optional, plus chosen `cause_id`) ·
`causes` (verified nonprofits) · `studies` → `invites` (status: invited/accepted/
completed/declined, unique per user+study) · `ledger` (incentive + contribution entries
keyed to invites) · `magic_links` + `sessions` for auth.

Quarterly fatigue cap (6) is computed from accepted+completed invites in the current
quarter and enforced server-side on accept.

### Routes

- `GET /` signed-out landing (redirects to `/dashboard` when signed in)
- `GET|POST /signin` request a magic link (per-email 60s cooldown)
- `GET /auth/:token` consume link → session; first sign-in creates account + invites
- `GET|POST /welcome` onboarding wizard (name required, demographics optional, cause pick)
- `GET /dashboard` invites, earnings, cause, pace meter, all from the DB
- `POST /cause`, `POST /invites/:id/accept`, `POST /signout`
- `POST /dev/complete/:id` dev-mode only: mark a session complete + write ledger split

## Deploying (Railway, same pattern as personabud.com)

1. New Railway service from this repo, root directory `platform/`.
2. Attach a volume; set `DATABASE_PATH` to a path on it.
3. Set `NODE_ENV=production`, `APP_ORIGIN`, `RESEND_API_KEY`, `MAIL_FROM`.
4. Point `app.participantsforgood.org` at the service.

## Not yet built (see docs/PLATFORM-PLAN.md)

Real study matching (today every open study invites everyone), scheduling, payouts
(Stripe/Tremendous), researcher + nonprofit + admin portals, screeners, and email
notifications beyond sign-in.
