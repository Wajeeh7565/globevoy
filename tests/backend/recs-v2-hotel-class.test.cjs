'use strict';
// GV-RECS-V2-STEP2: hostels / dorm beds are a separate class of stay (NUITEE_HOTEL_CLASS=on).
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../backend/services/domain/live-fares/nuitee-live-stays');
const { chooseOffer } = m._internal;
const room = (id, amount, name = 'Double Room') => ({ offerId: 'o' + id, offerRetailRate: { amount, currency: 'CAD' }, rates: [{ name, boardName: 'Room Only', retailRate: { total: [{ amount, currency: 'CAD' }] }, cancellationPolicies: { refundableTag: 'NRFN' } }] });
const payload = { data: [{ hotelId: 'lp1', roomTypes: [room(1, 175)] }, { hotelId: 'lp2', roomTypes: [room(2, 400)] }, { hotelId: 'lp3', roomTypes: [room(3, 150, 'Bed in 6-Bed Mixed Dormitory')] }],
  hotels: [{ id: 'lp1', name: 'Remember @ Phuket Town Hostel', rating: 9.6 }, { id: 'lp2', name: 'Sea View Resort', rating: 8.8 }, { id: 'lp3', name: 'Old Town Inn', rating: 9.0 }] };

test('classifies hostels by property name and dorm beds by room name', () => {
  const { hostelClass } = m._hotelClass;
  assert.equal(hostelClass({ hotelName: 'Remember @ Phuket Town Hostel' }), true);
  assert.equal(hostelClass({ hotelName: 'Old Town Inn', roomName: 'Bed in 6-Bed Mixed Dormitory' }), true);
  assert.equal(hostelClass({ hotelName: 'Rove Bur Dubai', roomName: 'Rover Room' }), false);
});
test('off: unchanged cheapest well-rated pick (the hostel)', () => {
  assert.equal(chooseOffer(payload, 'CAD', { env: {} }).hotelId, 'lp3');
});
test('on: couples never get a hostel or dorm bed; solo travellers only as a last resort', () => {
  const env = { NUITEE_HOTEL_CLASS: 'on' };
  assert.equal(chooseOffer(payload, 'CAD', { env, solo: false }).hotelId, 'lp2');
  assert.equal(chooseOffer(payload, 'CAD', { env, solo: true }).hotelId, 'lp2');
  const onlyHostels = { data: payload.data.filter(h => h.hotelId !== 'lp2'), hotels: payload.hotels };
  assert.equal(chooseOffer(onlyHostels, 'CAD', { env, solo: false }), null);
  assert.ok(chooseOffer(onlyHostels, 'CAD', { env, solo: true }));
  assert.ok(chooseOffer(payload, 'CAD', { env, all: true }).every(o => !o.hostelClass));
});
