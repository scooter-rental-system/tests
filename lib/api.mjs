// Shared helpers for tests that drive a running backend over HTTP. Configuration comes from the environment only
// (see README.md); nothing here holds a credential.
import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';

export const env = {
  baseUrl: process.env.API_BASE_URL?.replace(/\/+$/, ''),
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  deviceKey: process.env.GPS_DEVICE_API_KEY || '',
  timeZone: process.env.SERVER_TIME_ZONE || 'Asia/Colombo',
};

/** Why API tests cannot run, or null when they can. */
export const missingConfig = env.baseUrl && env.adminEmail && env.adminPassword
  ? null
  : 'API_BASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD must be set';

/** Calls the API; returns { status, body } and never throws on an HTTP error status. */
export async function call(method, path, { token, json, form, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  if (form) init.body = form;
  const res = await fetch(`${env.baseUrl}/api${path}`, init);
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status, body };
}

export function expectStatus(res, status, what) {
  assert.equal(res.status, status, `${what}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** "yyyy-MM-ddTHH:mm:ss" in the backend's zone (booking times are local date-times). */
export function serverLocalTime(offsetMinutes = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetMinutes * 60_000));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}`;
}

/** A 1x1 PNG, used as a transfer receipt image. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export async function adminToken() {
  return expectStatus(await call('POST', '/auth/login', { json: { email: env.adminEmail, password: env.adminPassword } }),
    200, 'admin login').token;
}

/** Registers a new customer with a synthetic 12-digit NIC; returns { token, user, email }. */
export async function registerCustomer(fullName = 'Test Rider') {
  const email = `test-rider-${Date.now()}-${randomBytes(3).toString('hex')}@example.com`;
  const body = expectStatus(await call('POST', '/auth/register', {
    json: {
      email, password: `Pw-${randomBytes(9).toString('base64url')}`, fullName,
      phone: '+94770000000', nicNumber: String(randomInt(1e11, 1e12 - 1)), consent: true,
    },
  }), 201, 'customer registration');
  return { ...body, email };
}

export async function availableScooter() {
  const scooter = expectStatus(await call('GET', '/scooters'), 200, 'scooter list').find((s) => s.available);
  assert.ok(scooter, 'an available scooter is needed');
  return scooter;
}

/** Turns bank transfer on (keeping the QR settings) so a booking can be paid without a card provider. */
export async function enableBankTransfer(admin) {
  const s = expectStatus(await call('GET', '/admin/payment-settings', { token: admin }), 200, 'payment settings');
  if (s.bankEnabled) return;
  expectStatus(await call('PUT', '/admin/payment-settings', {
    token: admin,
    json: {
      qrEnabled: s.qrEnabled, qrDisplayName: s.qrDisplayName, qrInstructions: s.qrInstructions,
      bankEnabled: true, bankName: 'Test Bank', bankAccountHolder: 'Scooter Rent Kandy',
      bankAccountNumber: '0000000000', bankBranch: 'Kandy', bankBranchCode: '000', bankInstructions: null,
    },
  }), 200, 'enable bank transfer');
}

/** A booking for the scooter now, with the agreement signed in the customer's own name (the backend requires it). */
export async function createSignedBooking(customer, scooter) {
  const booking = expectStatus(await call('POST', '/bookings', {
    token: customer.token,
    json: { scooterId: scooter.id, startTime: serverLocalTime(), gear: [], pickupLocation: 'Kandy yard' },
  }), 201, 'create booking');
  expectStatus(await call('POST', `/bookings/${booking.id}/contract/sign`, {
    token: customer.token, json: { signedName: customer.user.fullName, agree: true },
  }), 200, 'sign contract');
  return booking;
}

/** Pays the initial charge by bank transfer: receipt uploaded by the customer, amount approved by the admin. */
export async function payByBankTransfer(admin, customer, bookingId) {
  await enableBankTransfer(admin);
  expectStatus(await call('POST', `/bookings/${bookingId}/transfer`, { token: customer, json: { method: 'BANK_TRANSFER' } }),
    200, 'choose bank transfer');
  const form = new FormData();
  form.append('receipt', new Blob([PNG], { type: 'image/png' }), 'receipt.png');
  form.append('reference', 'AUTOMATED-TEST');
  expectStatus(await call('POST', `/bookings/${bookingId}/receipts`, { token: customer, form }), 200, 'upload receipt');
  const receipts = expectStatus(await call('GET', '/admin/payment-receipts', { token: admin }), 200, 'receipt queue');
  const receipt = receipts.find((r) => r.bookingId === bookingId);
  assert.ok(receipt, 'the receipt waits for verification');
  expectStatus(await call('POST', `/admin/payment-receipts/${receipt.id}/approve`, {
    token: admin, json: { amount: receipt.amount },
  }), 200, 'approve receipt');
}

/** Admin handover with the starting odometer (at least the scooter's recorded mileage), then the customer's start. */
export async function startRental(admin, customer, bookingId, startOdometerKm) {
  expectStatus(await call('POST', `/admin/bookings/${bookingId}/handover`, { token: admin, json: { startOdometerKm } }),
    200, 'handover');
  return expectStatus(await call('POST', `/bookings/${bookingId}/start`, { token: customer }), 200, 'start rental');
}

export async function completeRental(admin, bookingId, endOdometerKm) {
  return expectStatus(await call('PUT', `/bookings/${bookingId}/complete`, { token: admin, json: { endOdometerKm } }),
    200, 'complete rental');
}
