// A rental through the live API: GPS reports and tracking, card payment availability and a bank-transfer payment.
// Run with `npm run test:api` against a local or staging backend (see README.md). It registers its own customer and
// creates real records, so never point it at production.
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminToken, availableScooter, call, completeRental, env, expectStatus, missingConfig,
  payByBankTransfer, registerCustomer, serverLocalTime, startRental,
} from '../lib/api.mjs';

describe('rental with GPS and payments (live API)', { skip: missingConfig ?? false }, () => {
  let admin;
  let customer;
  let scooter;
  let booking;

  before(async () => {
    admin = await adminToken();
    customer = (await registerCustomer('API Test Rider')).token;
    scooter = await availableScooter();
  });

  it('refuses GPS reports and fleet tracking from anonymous callers', async () => {
    assert.equal((await call('GET', '/admin/gps/live')).status, 401);
    const body = { scooterCode: scooter.code, latitude: 7.29, longitude: 80.63, speedKmh: 10 };
    assert.equal((await call('POST', '/gps/pings', { json: body })).status, 401, 'no X-Device-Key');
    assert.equal((await call('POST', '/gps/pings', { headers: { 'X-Device-Key': 'wrong-key' }, json: body })).status, 401,
      'wrong X-Device-Key');
  });

  it('answers card payments from the configured provider, or 503 without one', async () => {
    booking = expectStatus(await call('POST', '/bookings', {
      token: customer,
      json: { scooterId: scooter.id, startTime: serverLocalTime(), gear: [], pickupLocation: 'Kandy yard' },
    }), 201, 'create booking');
    assert.equal(booking.stage, 'AWAITING_PAYMENT');
    const unsigned = await call('POST', `/bookings/${booking.id}/payment-intent`, { token: customer });
    assert.equal(unsigned.status, 400, 'no payment intent before the agreement is signed');
    expectStatus(await call('POST', `/bookings/${booking.id}/contract/sign`, {
      token: customer, json: { signedName: 'API Test Rider', agree: true },
    }), 200, 'sign contract');

    const config = expectStatus(await call('GET', '/payments/config', { token: customer }), 200, 'payment config');
    const intent = await call('POST', `/bookings/${booking.id}/payment-intent`, { token: customer });
    if (config.enabled) {
      assert.equal(config.provider, 'stripe');
      assert.match(config.publishableKey, /^pk_(test|live)_/);
      expectStatus(intent, 200, 'payment intent');
      assert.match(intent.body.clientSecret, /^pi_.+_secret_.+/);
    } else {
      expectStatus(intent, 503, 'payment intent without a provider');
    }
  });

  it('pays by bank transfer approved by an admin', async () => {
    await payByBankTransfer(admin, customer, booking.id);
    booking = expectStatus(await call('GET', `/bookings/${booking.id}`, { token: customer }), 200, 'booking');
    assert.equal(booking.stage, 'READY_FOR_PICKUP');
    const payment = expectStatus(await call('GET', `/bookings/${booking.id}/payment`, { token: customer }), 200, 'payment');
    assert.equal(payment.status, 'SUCCESS');
  });

  it('accepts rider locations only while the rental is under way', async () => {
    const early = await call('POST', `/bookings/${booking.id}/location`, { token: customer, json: { latitude: 7.2936, longitude: 80.6413 } });
    assert.equal(early.status, 409, 'no location before the rental starts');

    booking = await startRental(admin, customer, booking.id, scooter.totalMileage);
    assert.equal(booking.stage, 'IN_PROGRESS');
    expectStatus(await call('POST', `/bookings/${booking.id}/location`, {
      token: customer, json: { latitude: 7.2936, longitude: 80.6413, accuracyMeters: 12 },
    }), 202, 'rider location');
    const invalid = await call('POST', `/bookings/${booking.id}/location`, { token: customer, json: { latitude: 91, longitude: 80 } });
    assert.equal(invalid.status, 400, 'an impossible latitude is refused');

    const tracking = expectStatus(await call('GET', `/bookings/${booking.id}/tracking`, { token: customer }), 200, 'tracking');
    assert.equal(tracking.trail.length, 1);
    assert.equal(tracking.position.stale, false);
  });

  it('stores tracker pings with a UTC time on the rental, in server time', { skip: !env.deviceKey && 'GPS_DEVICE_API_KEY not set' }, async () => {
    const ping = (body) => call('POST', '/gps/pings', { headers: { 'X-Device-Key': env.deviceKey }, json: body });
    const utcNow = new Date().toISOString(); // "...Z", as GPS trackers usually report
    expectStatus(await ping({ scooterCode: scooter.code, latitude: 7.2950, longitude: 80.6420, speedKmh: 25, recordedAt: utcNow, bookingId: booking.id }),
      202, 'device ping with a UTC time');
    assert.equal((await ping({ scooterCode: 'NO-SUCH-SCOOTER', latitude: 7.29, longitude: 80.64, speedKmh: 0 })).status, 404);
    assert.equal((await ping({ scooterCode: scooter.code, latitude: 7.29, longitude: 80.64 })).status, 400, 'speed is required');

    const history = expectStatus(await call('GET', `/admin/gps/bookings/${booking.id}/history`, { token: admin }), 200, 'GPS history');
    assert.equal(history.points.length, 2, 'the rider report and the UTC device ping are both on the rental');
    const tracking = expectStatus(await call('GET', `/bookings/${booking.id}/tracking`, { token: customer }), 200, 'tracking');
    assert.equal(tracking.position.latitude, 7.295, 'the UTC ping is the latest position');
    assert.equal(tracking.position.stale, false, 'a UTC ping is not shown as hours old');
  });

  it('shows the fleet and payments to admins only', async () => {
    assert.equal((await call('GET', '/admin/gps/live', { token: customer })).status, 403);
    const live = expectStatus(await call('GET', '/admin/gps/live', { token: admin }), 200, 'live GPS');
    assert.ok(live.some((p) => p.scooterId === scooter.id), 'the rented scooter is in the live view');
    expectStatus(await call('GET', `/admin/gps/scooters/${scooter.id}/trail?hours=6`, { token: admin }), 200, 'trail');
    expectStatus(await call('GET', '/admin/gps/speed-violations?limit=10', { token: admin }), 200, 'speed violations');
    assert.equal((await call('GET', '/admin/payments', { token: customer })).status, 403);
    expectStatus(await call('GET', '/admin/payments', { token: admin }), 200, 'admin payments');
  });

  it('ends the rental at the counter and stops accepting locations', async () => {
    const done = await completeRental(admin, booking.id, scooter.totalMileage + 12.5);
    assert.notEqual(done.stage, 'IN_PROGRESS');
    const late = await call('POST', `/bookings/${booking.id}/location`, { token: customer, json: { latitude: 7.29, longitude: 80.64 } });
    assert.equal(late.status, 409, 'no location after the rental ended');
  });
});
