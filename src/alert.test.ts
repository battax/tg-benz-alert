import assert from "node:assert/strict";
import test from "node:test";
import { buildAdvice, buildMessage, shouldNotify } from "./alert.js";
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
  assert.match(message, /in linea con la tua soglia/);
  assert.match(message, /Verifica live MIMIT/);
});

test("il consiglio segue la distanza dalla soglia, non prezzi fissi", () => {
  // Le stesse relazioni valgono a qualunque livello di mercato.
  assert.match(buildAdvice(1.88, 1.93), /fare il pieno/);
  assert.match(buildAdvice(2.28, 2.33), /fare il pieno/);
  assert.match(buildAdvice(1.91, 1.93), /rifornimento abbondante/);
  assert.match(buildAdvice(1.929, 1.93), /in linea con la tua soglia/);
  assert.match(buildAdvice(1.95, 1.93), /solo il necessario/);
});

test("indica la soglia automatica e le rilevazioni usate", () => {
  const message = buildMessage({ offers: [best], threshold: 1.93, autoSamples: 24 });
  assert.match(message, /Soglia automatica: 1,930 €\/l/);
  assert.match(message, /24 rilevazioni/);
  assert.doesNotMatch(message, /Fabia/);
});

test("elenca anche i distributori sopra soglia, marcandoli", () => {
  const offers: Offer[] = [
    best,
    { ...best, id: "102", name: "Secondo", price: 1.949 },
    { ...best, id: "103", name: "Terzo", price: 1.999 },
  ];
  const message = buildMessage({ offers, threshold: 1.93 });

  assert.match(message, /^🥇 <b>1,929 €\/l<\/b> ✅ — <b>Quarto Fuel<\/b>$/m);
  assert.match(message, /^🥈 <b>1,949 €\/l<\/b> 🔸 — <b>Secondo<\/b>$/m);
  assert.match(message, /^🥉 <b>1,999 €\/l<\/b> 🔸 — <b>Terzo<\/b>$/m);
});
