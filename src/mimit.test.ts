import assert from "node:assert/strict";
import test from "node:test";
import { distanceKm } from "./geo.js";
import { buildSearchPoints, isTodayInRome } from "./mimit.js";

test("usa una sola ricerca per raggi fino a 10 km", () => {
  assert.deepEqual(buildSearchPoints(44.9969, 9.66388, 10), [
    { lat: 44.9969, lng: 9.66388 },
  ]);
});

test("riconosce soltanto aggiornamenti della giornata italiana corrente", () => {
  const now = new Date("2026-08-12T20:00:00Z");
  assert.equal(isTodayInRome("2026-08-12T07:00:00Z", now), true);
  assert.equal(isTodayInRome("2026-08-11T20:00:00Z", now), false);
});

test("copre il raggio di 15 km con centro e otto ricerche live", () => {
  const points = buildSearchPoints(44.9969, 9.66388, 15);
  assert.equal(points.length, 9);
  assert.equal(points[0]?.lat, 44.9969);
  assert.ok(
    points.slice(1).every((point) => {
      const distance = distanceKm(44.9969, 9.66388, point.lat, point.lng);
      return Math.abs(distance - 10) < 0.01;
    }),
  );
});

test("sposta l'anello a 15 km quando il raggio utente è 20 km", () => {
  const points = buildSearchPoints(44.9969, 9.66388, 20);
  const distance = distanceKm(44.9969, 9.66388, points[1]!.lat, points[1]!.lng);
  assert.ok(Math.abs(distance - 15) < 0.01);
});
