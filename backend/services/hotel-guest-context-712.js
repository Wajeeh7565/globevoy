'use strict';

function parseHotelGuestContext(value) {
  if (value == null) return null;
  const fail = () => { throw Object.assign(new Error('invalid-hotel-guest-context'), { statusCode: 400 }); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['guestNationality', 'occupancies'].includes(key))) fail();
  const guestNationality = String(value.guestNationality || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(guestNationality)) fail();
  let occupancies;
  if (value.occupancies != null) {
    if (!Array.isArray(value.occupancies) || value.occupancies.length < 1 || value.occupancies.length > 8) fail();
    occupancies = value.occupancies.map((room) => {
      if (!room || typeof room !== 'object' || Array.isArray(room) || Object.keys(room).some((key) => !['adults', 'children'].includes(key))) fail();
      if (!Number.isInteger(room.adults) || room.adults < 1 || room.adults > 64) fail();
      const children = room.children || [];
      if (!Array.isArray(children) || children.length > 16 || children.some((age) => !Number.isInteger(age) || age < 0 || age > 17)) fail();
      return { adults: room.adults, children: [...children] };
    });
    if (occupancies.reduce((n, room) => n + room.adults + room.children.length, 0) > 64) fail();
  }
  return { guestNationality, ...(occupancies ? { occupancies } : {}) };
}

module.exports = { parseHotelGuestContext };
