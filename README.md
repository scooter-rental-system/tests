# Scooter Rent Kandy – cross-repository tests

Tests that exercise the system as a whole: the live API, the frontend in a real browser, a deployed site, load on the
read endpoints, and the manual user acceptance scripts. **Unit and component tests stay in their own repositories**
and run in those repositories' CI:

| Repository | Where | Runner | Tests (2026-11-06, `develop`) |
| --- | --- | --- | --- |
| backend | `spring/src/test/java` (80 classes once BE-049 is merged) | JUnit 5, MockMvc, embedded PostgreSQL 16 (`./gradlew test`) | 665 on `develop` (79 classes); 672 with the BE-049 GPS fix |
| frontend | `src/*.test.mjs` (23 files) | `node:test` (`npm test`) | 457 |

Many frontend tests check source text with regular expressions rather than rendering components; the browser
behaviour is covered here in `e2e/`.

## Layout

| Folder | What | Creates data? | Safe against production? |
| --- | --- | --- | --- |
| `api/` | A full rental through the API: booking, agreement, card-payment availability, bank transfer approved by an admin, handover, rider GPS, tracker pings (including UTC timestamps), admin GPS views, return. | Yes | **No** |
| `e2e/` | Playwright (Chromium): admin sign-in and Live GPS, checkout payment step, rider GPS reported by the browser, and the plain-HTTP case where browsers refuse location. | Yes | **No** |
| `smoke/` | Read-only checks of a deployed site: SPA and deep links, `/api/health` through the proxy, protected endpoints, Stripe webhook reachable, HTTPS, security headers. | No | Yes |
| `performance/` | Steady concurrent load on the read endpoints; reports p50/p95/p99 latency and error rate against thresholds. | No (adds load) | Only at an agreed quiet time |
| `uat/` | Manual user acceptance scripts with result and sign-off tables. | — | Run on staging/production by the client |
| `lib/` | Shared API helpers. | | |

## Setup

Node.js 22 or later.

```bash
npm ci
npx playwright install chromium   # once, for e2e/
```

All configuration comes from environment variables; nothing is read from a file and no credential is stored here.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `API_BASE_URL` | api, e2e, performance | Backend origin, e.g. `http://localhost:8080` (or the site, through Nginx). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | api, e2e, performance | An admin account on that backend. Never printed. |
| `GPS_DEVICE_API_KEY` | api | The backend's tracker key; the device-ping test is skipped without it. |
| `SERVER_TIME_ZONE` | api, e2e | The backend's zone for booking times (default `Asia/Colombo`). |
| `FRONTEND_DIR` | e2e | A frontend clone with `npm ci` run (default `../frontend`); served by Vite with `/api` proxied to `API_BASE_URL`. |
| `E2E_PORT` | e2e | Port for that Vite server (default 5174). |
| `E2E_BASE_URL` | e2e | Test an already running site instead of starting Vite. |
| `E2E_INSECURE_BASE_URL` | e2e | The site over plain HTTP on a non-local address; enables the "location needs HTTPS" test. |
| `SITE_URL` | smoke | The deployed site, e.g. `https://app.example.lk`. |
| `CONCURRENCY`, `DURATION_S`, `MAX_P95_MS`, `MAX_ERROR_RATE` | performance | Load and thresholds (defaults 10, 30, 1000, 0.01). |

The API and E2E tests register their own customers (synthetic NICs, `@example.com` addresses), enable bank transfer
in the payment settings if it is off, and create bookings, payments and GPS records. Point them only at a local or
staging database.

## Running

```bash
npm run test:api                       # API flow
npm run test:e2e                       # browser tests (starts Vite unless E2E_BASE_URL is set)
SITE_URL=https://<site> npm run test:smoke
npm run perf                           # load on read endpoints
```

A local backend for these tests: run the backend from `spring/` with a local PostgreSQL and `GPS_DEVICE_API_KEY` set
(see the backend README). Without `PAYMENTS_PROVIDER=stripe` the card tests check the documented 503 instead of a
Stripe payment intent; with Stripe test keys they check a real intent.

## Results recorded so far

Local runs only, on a developer laptop (backend `develop` plus the BE-049 fix, fresh PostgreSQL 16, Vite dev server,
no Nginx, no Stripe keys). **Nothing here has been run against the EC2 deployment or production.**

| Suite | Result (2026-11-06) |
| --- | --- |
| api | 7/7 passed (and 6/7 on the backend without BE-049: the UTC tracker ping was refused with 409) |
| e2e | 4/4 passed, including the plain-HTTP case served on a LAN address |
| smoke | 5/6 against the Vite dev server; the security-header check fails there because Vite sends no security headers. It will also fail behind the current production Nginx: `infra/docker/nginx/nginx.conf` sets the headers at server level, and the `location /` block's own `add_header` stops them being inherited for the HTML pages (infra fix pending) |
| performance | 10 users, 20 s: 10,940 requests, 0 errors, p95 23–31 ms per endpoint. A local figure only, not production capacity |
| uat | **Not executed.** No client sign-off recorded |

These suites are not yet part of any CI workflow.
