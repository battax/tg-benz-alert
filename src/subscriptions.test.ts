import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeSubscriber, SubscriptionStore } from "./subscriptions.js";

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

test("completa gli iscritti salvati da versioni precedenti", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "benzina-legacy-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "subscribers.json");
  await writeFile(
    path,
    JSON.stringify({
      subscribers: [
        { chatId: 1, userId: 1, latitude: 45, longitude: 9 },
        { chatId: 2, userId: 2, hours: [], threshold: 0 },
        { userId: 3 },
      ],
    }),
    "utf8",
  );

  const store = new SubscriptionStore(path);
  await store.init();

  const restored = store.get(1);
  assert.equal(restored?.radiusKm, 10);
  assert.equal(restored?.threshold, 1.93);
  assert.deepEqual(restored?.hours, [7, 22]);
  assert.equal(restored?.enabled, true);
  assert.deepEqual(store.get(2)?.hours, [7, 22]);
  assert.equal(store.get(2)?.threshold, 1.93);
  assert.equal(store.list().length, 2, "la riga senza chatId viene scartata");
});

test("normalizza ore duplicate e fuori intervallo", () => {
  const subscriber = normalizeSubscriber({ chatId: 9, userId: 9, hours: [22, 7, 7, 30] });
  assert.deepEqual(subscriber?.hours, [7, 22]);
});
