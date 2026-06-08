# Threat Model

## Project Overview

This repository is a pnpm workspace containing a small Express API, a publicly deployed Finger Runner web game, a second web game artifact (`last-human`), an Expo mobile artifact (`finger-runner-mobile`), and a mockup sandbox used for design/development. The currently reachable public deployment serves the Finger Runner frontend at `/` and the Express API at `/api/healthz` on `https://finger-runner--trevorjohnbeck.replit.app`.

The production stack in scope is TypeScript on Node.js 24, Express 5, Vite-built static frontends, and a PostgreSQL/Drizzle library that is provisioned in the repo but not yet used by public routes.

## Assets

- **Deployment origin integrity** — the public deployment must not expose arbitrary script execution, attacker-controlled content injection, or server-side file exposure.
- **Application availability** — the public game and API should not expose unauthenticated resource exhaustion or crash paths that are trivial to trigger remotely.
- **Future backend/data access capability** — the repo already includes a DB layer and generated API client libraries; if these become reachable later, their request construction and query boundaries will matter.
- **Environment secrets** — `DATABASE_URL` and any future service secrets must remain server-only and must not leak through client bundles, logs, or error responses.

## Trust Boundaries

- **Browser to public deployment** — all requests from anonymous internet users to the Finger Runner site and `/api/*` endpoints cross this boundary. The browser is untrusted.
- **API server to database library** — the Express server can import the DB package; any future query path must treat request data as untrusted and use parameterized access.
- **Build-time/dev-only tooling vs production** — Vite dev plugins, mockup sandbox tooling, and Expo build scripts exist in the repo but are not production-reachable unless separately deployed.
- **Static frontend persistence boundary** — game state stored in `localStorage` or client-side cookies is attacker-controlled and cannot be trusted for security decisions.

## Scan Anchors

- **Current public entry points:** `artifacts/finger-runner/src/*` for the deployed web app, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*` for `/api`.
- **Higher-risk code areas:** any direct DOM writes in `artifacts/last-human/src/game/ui.ts`, static file serving in `artifacts/finger-runner-mobile/server/serve.js`, and shared request construction in `lib/api-client-react/src/custom-fetch.ts`.
- **Public vs authenticated vs admin:** all current public surfaces appear anonymous; there is no implemented auth or admin surface yet.
- **Usually dev-only / ignore unless proven reachable:** `artifacts/mockup-sandbox/**`, Vite cartographer/dev-banner plugins, Expo build scripts under `artifacts/finger-runner-mobile/scripts/**`.

## Threat Categories

### Tampering

All server-side behavior must treat request data, headers, URLs, and client-side persisted state as untrusted. If the API grows beyond health checks, validation must happen server-side and any file-system or database access must not derive unsafe paths or queries from user input.

### Information Disclosure

The public deployment must not expose secrets, internal filesystem contents, stack traces, or unnecessary data through API responses, static file serving, or logs. Client bundles must not embed server-only configuration such as database credentials.

### Denial of Service

Public endpoints must avoid trivial crash paths and should not allow unauthenticated users to trigger expensive work, unbounded uploads, or repeated blocking operations. This is currently most relevant if auxiliary servers such as the Expo static server are promoted to production.

### Elevation of Privilege

There is no implemented auth/admin model today, so privilege escalation currently maps to arbitrary script execution in the browser, path traversal in server-side file serving, or injection into any future database-backed endpoints. Any future protected routes must enforce authorization on the server, not in client state.
