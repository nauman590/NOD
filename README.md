# NOD — Tasker monorepo

A monorepo recreation of the "Tasker" on-demand-services app.

- **`apps/web`** — React 19 + Vite + Tailwind v4 + react-router-dom. Pixel-perfect, mobile-first frontend recreated from the original Lovable project. Runs on **http://localhost:5173**.
- **`apps/api`** — NestJS 11 scaffold (health endpoint only for now; no database wired yet). Runs on **http://localhost:3001/api**.

## Getting started

```bash
npm install        # installs all workspaces
npm run dev        # runs web + api together
```

Individual apps:

```bash
npm run dev:web    # frontend only (5173)
npm run dev:api    # backend only (3001)
```

## Frontend pages

| Route | Screen |
| --- | --- |
| `/` | Home — add photo, pick task type, describe |
| `/estimate` | AI-estimated price breakdown |
| `/checkout` | Stripe-placeholder checkout |
| `/provider` | Provider job dashboard (available / active) |
| `/provider/adjust/:jobId` | Provider adds price adjustments |
| `/provider/approval/:jobId` | Customer approval of add-ons |

State is kept client-side in `sessionStorage`/`localStorage` — no backend needed for the demo flow.

## Database (future)

The API is DB-agnostic right now. MySQL or PostgreSQL can be added later via
`@nestjs/typeorm` (or Prisma) without touching the frontend.
