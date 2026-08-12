import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SubscriptionStore } from "./subscriptions.js";

test("crea e conserva la configurazione di un utente", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "benzina-subscribers-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "subscribers.json");
  const store = new SubscriptionStore(path);
  await store.init();

  const subscriber = await store.upsertIdentity({
    chatId: 123,
    userId: 456,
    firstName: "Giuseppe",
  });
  assert.equal(subscriber.threshold, 1.93);
  assert.deepEqual(subscriber.hours, [7, 22]);

  await store.update(123, { latitude: 45.05, longitude: 9.69, radiusKm: 15 });
  const reloaded = new SubscriptionStore(path);
  await reloaded.init();
  assert.equal(reloaded.get(123)?.latitude, 45.05);
  assert.equal(reloaded.get(123)?.radiusKm, 15);
  assert.match(await readFile(path, "utf8"), /Giuseppe/);
});
