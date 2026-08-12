import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { fetchOffers } from "./mimit.js";

interface FakeFuel {
  fuelId: number;
  isSelf: boolean;
  price: number;
  validityDate?: string;
}

function station(id: number, price: number, fuel: Partial<FakeFuel> = {}) {
  return {
    id,
    name: `Impianto ${id}`,
    brand: "Bianca",
    address: `Via ${id}`,
    location: { lat: 44.9969, lng: 9.66388 },
    insertDate: new Date().toISOString(),
    fuels: [{ id, name: "Benzina", fuelId: 1, isSelf: true, price, ...fuel }],
  };
}

/** Sostituisce `fetch` per la durata del test e conta le chiamate. */
function stubFetch(
  context: TestContext,
  handler: (url: string, call: number) => Response,
): { calls: () => number } {
  const original = globalThis.fetch;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    return handler(String(input), calls);
  }) as typeof fetch;
  return { calls: () => calls };
}

const options = {
  liveApiUrl: "https://esempio.test/ospzApi",
  centerLat: 44.9969,
  centerLon: 9.66388,
  radiusKm: 10,
  maxResults: 5,
  requireTodayUpdate: true,
};

test("ritenta dopo un 429 invece di perdere il distributore", async (context) => {
  const stub = stubFetch(context, (url, call) => {
    if (call === 1) {
      return new Response("", { status: 429, headers: { "retry-after": "0" } });
    }
    if (url.includes("/search/zone")) {
      return Response.json({ success: true, results: [station(101, 1.899)] });
    }
    return Response.json({ ...station(101, 1.879), company: "Gestore Srl" });
  });

  const { offers } = await fetchOffers(options);

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.price, 1.879);
  assert.equal(offers[0]?.manager, "Gestore Srl");
  assert.equal(stub.calls(), 3);
});

test("propaga l'errore quando i tentativi si esauriscono", async (context) => {
  stubFetch(context, () => new Response("", { status: 429, headers: { "retry-after": "0" } }));

  await assert.rejects(fetchOffers(options), /API live MIMIT non disponibile \(429\)/);
});

test("tiene i prezzi validi da giorni se l'impianto ha comunicato oggi", async (context) => {
  stubFetch(context, (url) => {
    const vecchio = { validityDate: "2020-01-01T08:00:00.000Z" };
    if (url.includes("/search/zone")) {
      return Response.json({ success: true, results: [station(202, 1.909, vecchio)] });
    }
    return Response.json(station(202, 1.909, vecchio));
  });

  const { offers } = await fetchOffers(options);

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.id, "202");
});

test("ordina per prezzo e deduplica gli impianti trovati da più ricerche", async (context) => {
  stubFetch(context, (url) => {
    if (url.includes("/search/zone")) {
      return Response.json({
        success: true,
        results: [station(301, 1.999), station(302, 1.879), station(301, 1.999)],
      });
    }
    const id = Number(url.split("/").pop());
    return Response.json(station(id, id === 301 ? 1.999 : 1.879));
  });

  const { offers } = await fetchOffers({ ...options, radiusKm: 20 });

  assert.deepEqual(
    offers.map((offer) => offer.id),
    ["302", "301"],
  );
});

test("un dettaglio non disponibile non elimina il distributore", async (context) => {
  stubFetch(context, (url) => {
    if (url.includes("/search/zone")) {
      return Response.json({ success: true, results: [station(404, 1.889)] });
    }
    return new Response("", { status: 404 });
  });

  const { offers } = await fetchOffers(options);

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.price, 1.889);
});
