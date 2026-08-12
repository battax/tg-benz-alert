import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPriceSample,
  effectiveThreshold,
  HISTORY_DAYS,
  MAX_SAMPLES,
  percentile,
} from "./threshold.js";
import type { PriceSample } from "./types.js";

const now = new Date("2026-08-12T20:00:00Z");

/** Rilevazioni ordinate, tutte dentro la finestra utile. */
function history(prices: number[], spacingMs = 43_200_000, from = now): PriceSample[] {
  return prices.map((price, index) => ({
    at: new Date(from.getTime() - (prices.length - index) * spacingMs).toISOString(),
    price,
  }));
}

test("il percentile resta dentro i valori disponibili", () => {
  assert.equal(percentile([1.9, 1.8, 2.0], 0), 1.8);
  assert.equal(percentile([1.9, 1.8, 2.0], 1), 2.0);
  assert.equal(percentile([1.8, 1.85, 1.9, 1.95], 0.3), 1.85);
  assert.equal(percentile([], 0.3), undefined);
});

test("usa la soglia fissa finché lo storico è corto", () => {
  const result = effectiveThreshold({
    mode: "auto",
    fixed: 1.93,
    history: history([1.9, 1.91, 1.92]),
    now,
  });
  assert.equal(result.auto, false);
  assert.equal(result.value, 1.93);
  assert.equal(result.samples, 3);
});

test("ricava la soglia dai prezzi migliori delle ultime due settimane", () => {
  const result = effectiveThreshold({
    mode: "auto",
    fixed: 1.93,
    history: history([1.9, 1.95, 1.92, 1.98, 1.94, 1.96, 1.99, 2.01]),
    now,
  });
  assert.equal(result.auto, true);
  assert.equal(result.samples, 8);
  // Ordinati: 1,90 1,92 1,94 1,95 1,96 1,98 1,99 2,01 → terzo valore.
  assert.equal(result.value, 1.94);
});

test("la soglia automatica segue il mercato quando i prezzi salgono", () => {
  const base = [1.9, 1.95, 1.92, 1.98, 1.94, 1.96, 1.99, 2.01];
  const magro = effectiveThreshold({ mode: "auto", fixed: 1.93, history: history(base), now });
  const caro = effectiveThreshold({
    mode: "auto",
    fixed: 1.93,
    history: history(base.map((price) => price + 0.15)),
    now,
  });
  assert.equal(magro.auto, true);
  assert.ok(caro.value > magro.value + 0.14, "la soglia si alza con il mercato");
});

test("la modalità fissa ignora lo storico", () => {
  const result = effectiveThreshold({
    mode: "fixed",
    fixed: 1.93,
    history: history([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]),
    now,
  });
  assert.equal(result.auto, false);
  assert.equal(result.value, 1.93);
});

test("lo storico scarta le rilevazioni scadute e resta limitato", () => {
  const vecchia = new Date(now.getTime() - (HISTORY_DAYS + 1) * 86_400_000).toISOString();
  const updated = appendPriceSample(
    [{ at: vecchia, price: 1.5 }, ...history([1.9, 1.91])],
    1.899,
    now.toISOString(),
    now,
  );

  assert.equal(updated.length, 3, "la rilevazione oltre i 14 giorni esce");
  assert.equal(updated.at(-1)?.price, 1.899);

  const sovraccarico = Array.from({ length: MAX_SAMPLES + 20 }, () => 1.9);
  assert.equal(
    appendPriceSample(history(sovraccarico, 60_000), 1.899, now.toISOString(), now).length,
    MAX_SAMPLES,
  );
});
