import assert from "node:assert/strict";
import test from "node:test";
import { buildMessage, shouldNotify } from "./alert.js";
import type { Offer } from "./types.js";

const best: Offer = {
  id: "101",
  manager: "Gestore Srl",
  brand: "Bianca",
  roadType: "Stradale",
  name: "Quarto Fuel",
  address: "Via Roma 1",
  city: "Gossolengo",
  province: "Piacenza",
  latitude: 44.9969,
  longitude: 9.66388,
  price: 1.929,
  communicatedAt: "11/08/2026 08:00:00",
  distanceKm: 1.2,
};

test("notifica al primo passaggio sotto soglia", () => {
  assert.equal(
    shouldNotify({ state: { lastWasBelow: false }, best, threshold: 1.93, minDrop: 0.005 }),
    true,
  );
});

test("non duplica lo stesso prezzo e distributore", () => {
  assert.equal(
    shouldNotify({
      state: { lastWasBelow: true, lastAlertPrice: 1.929, lastAlertStationId: "101" },
      best,
      threshold: 1.93,
      minDrop: 0.005,
    }),
    false,
  );
});

test("il messaggio include prezzo, distanza e consiglio", () => {
  const message = buildMessage({
    offers: [best],
    threshold: 1.93,
    checkedAt: "2026-08-12T13:00:00Z",
  });
  assert.match(message, /1,929 €/);
  assert.match(message, /1,2 km/);
  assert.match(message, /fare il pieno/);
  assert.match(message, /Verifica live MIMIT/);
});
