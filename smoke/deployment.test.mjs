// Read-only smoke test of a deployed site (frontend + /api behind the same origin, as Nginx serves it). It creates
// nothing, so it is safe against production: `SITE_URL=https://... npm run test:smoke`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SITE = process.env.SITE_URL?.replace(/\/+$/, '');

async function get(path, init) {
  const res = await fetch(`${SITE}${path}`, { redirect: 'manual', ...init });
  return { res, text: await res.text() };
}

describe(`deployed site ${SITE ?? ''}`, { skip: !SITE && 'SITE_URL not set' }, () => {
  it('serves the single-page app, including on deep links', async () => {
    for (const path of ['/', '/scooters', '/bookings/00000000-0000-0000-0000-000000000000']) {
      const { res, text } = await get(path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/, path);
      assert.match(text, /<div id="root">/, path);
    }
  });

  it('reaches the backend through the same origin', async () => {
    const { res, text } = await get('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text), { status: 'UP' });
    const scooters = await get('/api/scooters');
    assert.equal(scooters.res.status, 200);
    assert.ok(Array.isArray(JSON.parse(scooters.text)));
  });

  it('protects signed-in, admin and device endpoints', async () => {
    assert.equal((await get('/api/me')).res.status, 401);
    assert.equal((await get('/api/payments/config')).res.status, 401);
    assert.equal((await get('/api/admin/gps/live')).res.status, 401);
    const ping = await get('/api/gps/pings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scooterCode: 'SMOKE', latitude: 7.29, longitude: 80.63, speedKmh: 0 }),
    });
    assert.equal(ping.res.status, 401, 'device reports need X-Device-Key');
  });

  it('exposes the Stripe webhook, which refuses unsigned events', async () => {
    const { res } = await get('/api/webhooks/stripe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    // 400: Stripe is configured and the signature is checked. 503: no payment provider is configured.
    assert.ok([400, 503].includes(res.status), `webhook answered ${res.status}`);
  });

  it('is a secure context, so browsers share rider location and Stripe can run in live mode', () => {
    const url = new URL(SITE);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    assert.ok(url.protocol === 'https:' || local,
      `${SITE} is plain HTTP: browsers refuse geolocation there and Stripe live mode needs HTTPS`);
  });

  it('sends the basic security headers', async () => {
    const { res } = await get('/');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-frame-options'), 'X-Frame-Options');
  });
});
