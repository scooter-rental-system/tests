// Browser tests of the GPS and payment journeys, against a running backend through the real frontend. The bookings
// they need are prepared through the API (lib/api.mjs), then driven in Chromium. They create real records: run them
// only against a local or staging backend. See README.md for the environment variables.
import { expect, test } from '@playwright/test';
import {
  adminToken, availableScooter, call, createSignedBooking, env, expectStatus, missingConfig, payByBankTransfer,
  registerCustomer, startRental,
} from '../lib/api.mjs';

test.skip(Boolean(missingConfig), missingConfig ?? '');

/** Kandy, by the lake: a fixed position the browser reports in place of a real fix. */
const KANDY = { latitude: 7.2936, longitude: 80.6413 };
const TOKEN_KEY = 'srs.token';

/** Opens a page signed in with an API token (the frontend keeps it in localStorage). */
async function signedIn(page, token, path) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [TOKEN_KEY, token]);
  await page.goto(path);
}

test('an admin signs in through the login form and sees the live GPS fleet', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(env.adminEmail);
  await page.locator('#login-password').fill(env.adminPassword);
  await page.locator('#login-form').getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/admin/);

  await page.goto('/admin/gps');
  await expect(page.getByRole('heading', { name: 'Live GPS' })).toBeVisible();
  const scooter = await availableScooter();
  await expect(page.getByText(scooter.code).first()).toBeVisible();
});

test('checkout offers card payment through Stripe, or says plainly that it is unavailable', async ({ page }) => {
  const customer = await registerCustomer('E2E Checkout Rider');
  const booking = await createSignedBooking(customer, await availableScooter());
  const config = expectStatus(await call('GET', '/payments/config', { token: customer.token }), 200, 'payment config');

  await signedIn(page, customer.token, `/bookings/${booking.id}/checkout`);
  await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();
  if (config.enabled) {
    // Stripe's Payment Element: card fields live in Stripe's own frame, never in this page.
    await expect(page.locator('iframe[src*="js.stripe.com"]').first()).toBeAttached({ timeout: 30_000 });
    await expect(page.locator('input[name="cardnumber"]')).toHaveCount(0);
  } else {
    await expect(page.getByText(/Card payment is temporarily unavailable/)).toBeVisible();
  }
  // Nothing was charged or confirmed by opening the page.
  const after = expectStatus(await call('GET', `/bookings/${booking.id}`, { token: customer.token }), 200, 'booking');
  expect(after.stage).toBe('AWAITING_PAYMENT');
});

test.describe('rider GPS from the browser', () => {
  test.use({ geolocation: KANDY, permissions: ['geolocation'] });

  test('the rental page reports the browser location and shows it live', async ({ page }) => {
    const admin = await adminToken();
    const customer = await registerCustomer('E2E GPS Rider');
    const scooter = await availableScooter();
    const booking = await createSignedBooking(customer, scooter);
    await payByBankTransfer(admin, customer.token, booking.id);
    await startRental(admin, customer.token, booking.id, scooter.totalMileage);

    await signedIn(page, customer.token, `/bookings/${booking.id}`);
    await expect(page.getByRole('heading', { name: 'Live rental' })).toBeVisible();
    await expect(page.getByText('Location tracking active.')).toBeVisible({ timeout: 20_000 });

    // The backend received the browser's position for this rental.
    await expect.poll(async () => {
      const t = await call('GET', `/bookings/${booking.id}/tracking`, { token: customer.token });
      return t.status === 200 ? t.body.trail.length : -1;
    }, { timeout: 20_000 }).toBeGreaterThan(0);
    const tracking = expectStatus(await call('GET', `/bookings/${booking.id}/tracking`, { token: customer.token }), 200, 'tracking');
    expect(tracking.position.latitude).toBeCloseTo(KANDY.latitude, 4);
    expect(tracking.position.longitude).toBeCloseTo(KANDY.longitude, 4);
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 20_000 });

    // The admin's route view for this rental has the report too.
    const history = expectStatus(await call('GET', `/admin/gps/bookings/${booking.id}/history`, { token: admin }), 200, 'history');
    expect(history.points.length).toBeGreaterThan(0);
    await call('PUT', `/bookings/${booking.id}/complete`, { token: admin, json: { endOdometerKm: scooter.totalMileage + 3 } });
  });

  // Browsers share location only with secure pages (HTTPS, or http://localhost). E2E_INSECURE_BASE_URL is the same
  // site over plain HTTP on a non-local address, e.g. a deployment without TLS: rider GPS cannot work there.
  test('over plain HTTP the rental page explains that location needs HTTPS', async ({ page }) => {
    const insecure = process.env.E2E_INSECURE_BASE_URL?.replace(/\/+$/, '');
    test.skip(!insecure, 'E2E_INSECURE_BASE_URL not set');
    const admin = await adminToken();
    const customer = await registerCustomer('E2E Insecure Rider');
    const scooter = await availableScooter();
    const booking = await createSignedBooking(customer, scooter);
    await payByBankTransfer(admin, customer.token, booking.id);
    await startRental(admin, customer.token, booking.id, scooter.totalMileage);

    await signedIn(page, customer.token, `${insecure}/bookings/${booking.id}`);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    await expect(page.getByText('Location tracking needs a secure (HTTPS) connection')).toBeVisible({ timeout: 20_000 });
    const tracking = expectStatus(await call('GET', `/bookings/${booking.id}/tracking`, { token: customer.token }), 200, 'tracking');
    expect(tracking.trail).toHaveLength(0);
    await call('PUT', `/bookings/${booking.id}/complete`, { token: admin, json: { endOdometerKm: scooter.totalMileage + 1 } });
  });
});
