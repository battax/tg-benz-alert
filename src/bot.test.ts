import assert from "node:assert/strict";
import test from "node:test";
import { parseHours, parseRadius, parseThreshold } from "./bot.js";

test("accetta soglie italiane con virgola", () => {
  assert.equal(parseThreshold("1,925 €"), 1.925);
  assert.equal(parseThreshold("0,900"), undefined);
});

test("limita il raggio personalizzato a 20 km", () => {
  assert.equal(parseRadius("15 km"), 15);
  assert.equal(parseRadius("21"), undefined);
});

test("normalizza e ordina gli orari", () => {
  assert.deepEqual(parseHours("22, 7, 7"), [7, 22]);
  assert.equal(parseHours("7,24"), undefined);
});
