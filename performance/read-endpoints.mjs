// Latency and error rate of the main read endpoints under a small, steady concurrent load. Read-only, but it does
// put load on the target: run it against a local or staging backend, or production only at an agreed quiet time.
//   API_BASE_URL   origin of the backend (or of the site, through Nginx)        required
//   ADMIN_EMAIL / ADMIN_PASSWORD  adds the admin live-GPS view to the mix        optional
//   CONCURRENCY    parallel virtual users (default 10)
//   DURATION_S     seconds of load (default 30)
//   MAX_P95_MS     fails when any endpoint's 95th percentile exceeds it (default 1000)
//   MAX_ERROR_RATE fails above this share of non-2xx or failed requests (default 0.01)
// Exit code 1 when a threshold is missed. Results describe this run on this target only, not production capacity.
import { performance } from 'node:perf_hooks';

const BASE = process.env.API_BASE_URL?.replace(/\/+$/, '');
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const DURATION_MS = Number(process.env.DURATION_S || 30) * 1000;
const MAX_P95_MS = Number(process.env.MAX_P95_MS || 1000);
const MAX_ERROR_RATE = Number(process.env.MAX_ERROR_RATE || 0.01);

if (!BASE) {
  console.error('API_BASE_URL is required');
  process.exit(2);
}

async function adminToken() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) return null;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: HTTP ${res.status}`);
  return (await res.json()).token;
}

const token = await adminToken();
const scooters = await (await fetch(`${BASE}/api/scooters`)).json();
const targets = [
  { name: 'GET /api/health', path: '/api/health' },
  { name: 'GET /api/scooters', path: '/api/scooters' },
  { name: 'GET /api/scooters/{id}', path: `/api/scooters/${scooters[0]?.id}` },
  { name: 'GET /api/gear', path: '/api/gear' },
  ...(token ? [{ name: 'GET /api/admin/gps/live', path: '/api/admin/gps/live', token }] : []),
];
const stats = new Map(targets.map((t) => [t.name, { times: [], errors: 0 }]));

async function user(deadline, offset) {
  for (let i = offset; performance.now() < deadline; i++) {
    const t = targets[i % targets.length];
    const s = stats.get(t.name);
    const start = performance.now();
    try {
      const res = await fetch(`${BASE}${t.path}`, { headers: t.token ? { Authorization: `Bearer ${t.token}` } : {} });
      await res.arrayBuffer();
      if (!res.ok) s.errors++;
    } catch {
      s.errors++;
    }
    s.times.push(performance.now() - start);
  }
}

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : NaN;

console.log(`Load: ${CONCURRENCY} users for ${DURATION_MS / 1000}s against ${BASE}`);
const began = performance.now();
const deadline = began + DURATION_MS;
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => user(deadline, i)));
const elapsedS = (performance.now() - began) / 1000;

let failed = false;
let total = 0;
let errors = 0;
const rows = [];
for (const [name, s] of stats) {
  const sorted = [...s.times].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  total += sorted.length;
  errors += s.errors;
  if (p95 > MAX_P95_MS) failed = true;
  rows.push({
    endpoint: name, requests: sorted.length, errors: s.errors,
    'p50 ms': Math.round(percentile(sorted, 0.5)), 'p95 ms': Math.round(p95), 'p99 ms': Math.round(percentile(sorted, 0.99)),
    'max ms': Math.round(sorted.at(-1) ?? NaN),
  });
}
console.table(rows);
const errorRate = total ? errors / total : 1;
if (errorRate > MAX_ERROR_RATE) failed = true;
console.log(`Total ${total} requests, ${(total / elapsedS).toFixed(1)} req/s, error rate ${(errorRate * 100).toFixed(2)}%`);
console.log(failed ? `FAILED: p95 > ${MAX_P95_MS} ms or error rate > ${MAX_ERROR_RATE * 100}%` : 'PASSED thresholds');
process.exit(failed ? 1 : 0);
