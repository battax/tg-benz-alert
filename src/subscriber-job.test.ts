import assert from "node:assert/strict";
import test from "node:test";
import { getRomeScheduleSlot } from "./subscriber-job.js";

test("genera lo slot secondo l'ora italiana", () => {
  const summer = getRomeScheduleSlot(new Date("2026-08-12T20:15:00Z"));
  assert.deepEqual(summer, {
    date: "2026-08-12",
    hour: 22,
    key: "2026-08-12-22",
  });
});
