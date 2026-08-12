import { distanceKm } from "./geo.js";
import type { Offer } from "./types.js";

const LIVE_SEARCH_RADIUS_KM = 10;

/**
 * L'API MIMIT risponde 429 se riceve troppe richieste ravvicinate. Teniamo
 * poche richieste in volo, distanziate tra loro, e ritentiamo con attesa
 * crescente: meglio un controllo di qualche secondo che una lista dimezzata.
 */
const MAX_CONCURRENT_REQUESTS = 3;
const MIN_REQUEST_GAP_MS = 250;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 800;
const MAX_RETRY_DELAY_MS = 8_000;

interface SearchPoint {
  lat: number;
  lng: number;
}

interface LiveFuel {
  id: number;
  price: number;
  name: string;
  fuelId: number;
  isSelf: boolean;
  insertDate?: string;
  validityDate?: string;
}

interface LiveStation {
  id: number;
  name?: string;
  nomeImpianto?: string;
  fuels: LiveFuel[];
  location: SearchPoint;
  insertDate?: string;
  address?: string | null;
  brand?: string;
  distance?: string;
}

interface LiveSearchResponse {
  success: boolean;
  results: LiveStation[];
}

interface LiveStationDetail extends LiveStation {
  company?: string;
}

export function isTodayInRome(value: string | undefined, now = new Date()): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date) === formatter.format(now);
}

function destinationPoint(
  latitude: number,
  longitude: number,
  distance: number,
  bearingDegrees: number,
): SearchPoint {
  const earthRadiusKm = 6371.0088;
  const angularDistance = distance / earthRadiusKm;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (latitude * Math.PI) / 180;
  const lon1 = (longitude * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (lon2 * 180) / Math.PI };
}

/**
 * L'API ufficiale limita ogni ricerca a 10 km. Per mantenere un raggio di
 * fino a 20 km interroghiamo il centro e otto punti su un anello, poi deduplichiamo
 * e applichiamo nuovamente la distanza esatta dal punto di partenza.
 */
export function buildSearchPoints(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
): SearchPoint[] {
  const center = { lat: centerLat, lng: centerLon };
  if (radiusKm <= LIVE_SEARCH_RADIUS_KM) return [center];

  const ringDistance = Math.max(1, radiusKm - 5);
  const ring = Array.from({ length: 8 }, (_, index) =>
    destinationPoint(centerLat, centerLon, ringDistance, index * 45),
  );
  return [center, ...ring];
}

function asLiveSearchResponse(value: unknown): LiveSearchResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("success" in value) ||
    !("results" in value) ||
    !Array.isArray(value.results)
  ) {
    throw new Error("Risposta non valida dall'API live MIMIT");
  }

  return value as LiveSearchResponse;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Distanzia l'inizio di ogni richiesta: le chiamate restano concorrenti, ma
 * non partono tutte nello stesso istante.
 */
let requestGate: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function reserveRequestSlot(): Promise<void> {
  requestGate = requestGate.then(async () => {
    const pause = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (pause > 0) await wait(pause);
    lastRequestAt = Date.now();
  });
  return requestGate;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!);
    }
  });

  await Promise.all(runners);
  return results;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function backoffMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
}

type Attempt<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; retryAfter?: number };

async function attemptFetch<T>(url: string, init?: RequestInit): Promise<Attempt<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      "user-agent": "telegram-benzina-alert/1.1",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const retryAfter = retryAfterMs(response);
    return retryAfter === undefined
      ? { ok: false, status: response.status }
      : { ok: false, status: response.status, retryAfter };
  }
  return { ok: true, data: (await response.json()) as T };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const lastAttempt = attempt >= MAX_ATTEMPTS;
    await reserveRequestSlot();

    let outcome: Attempt<T>;
    try {
      outcome = await attemptFetch<T>(url, init);
    } catch (error) {
      if (lastAttempt) throw error;
      await wait(backoffMs(attempt));
      continue;
    }

    if (outcome.ok) return outcome.data;
    if (lastAttempt || !isRetryableStatus(outcome.status)) {
      throw new Error(`API live MIMIT non disponibile (${outcome.status})`);
    }
    await wait(outcome.retryAfter ?? backoffMs(attempt));
  }
}

async function searchAround(apiUrl: string, point: SearchPoint): Promise<LiveStation[]> {
  const raw = await fetchJson<unknown>(`${apiUrl}/search/zone`, {
    method: "POST",
    body: JSON.stringify({
      points: [point],
      radius: LIVE_SEARCH_RADIUS_KM,
      fuelType: "1-1",
    }),
  });
  const response = asLiveSearchResponse(raw);
  if (!response.success) throw new Error("Ricerca live MIMIT non riuscita");
  return response.results;
}

function stationToOffer(
  station: LiveStation,
  centerLat: number,
  centerLon: number,
): Offer | undefined {
  const fuel = station.fuels.find(
    (item) => item.fuelId === 1 && item.isSelf && Number.isFinite(item.price),
  );
  if (
    !fuel ||
    !station.location ||
    !Number.isFinite(station.location.lat) ||
    !Number.isFinite(station.location.lng)
  ) {
    return undefined;
  }

  return {
    id: String(station.id),
    manager: "",
    brand: station.brand ?? "",
    roadType: "Stradale",
    name: station.name ?? station.nomeImpianto ?? station.brand ?? `Impianto ${station.id}`,
    address: station.address ?? "",
    city: "",
    province: "",
    latitude: station.location.lat,
    longitude: station.location.lng,
    price: fuel.price,
    communicatedAt: fuel.validityDate ?? fuel.insertDate ?? station.insertDate ?? "",
    distanceKm: distanceKm(centerLat, centerLon, station.location.lat, station.location.lng),
  };
}

async function enrichOffer(apiUrl: string, offer: Offer): Promise<Offer> {
  try {
    const detail = await fetchJson<LiveStationDetail>(
      `${apiUrl}/registry/servicearea/${encodeURIComponent(offer.id)}`,
    );
    const fuel = detail.fuels?.find((item) => item.fuelId === 1 && item.isSelf);
    return {
      ...offer,
      manager: detail.company ?? offer.manager,
      brand: detail.brand ?? offer.brand,
      name: detail.nomeImpianto ?? detail.name ?? offer.name,
      address: detail.address ?? offer.address,
      price: fuel?.price ?? offer.price,
      communicatedAt:
        fuel?.validityDate ?? fuel?.insertDate ?? detail.insertDate ?? offer.communicatedAt,
    };
  } catch (error) {
    console.warn(`Dettaglio impianto ${offer.id} non disponibile:`, error);
    return offer;
  }
}

export async function fetchOffers(options: {
  liveApiUrl: string;
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  maxResults: number;
  requireTodayUpdate: boolean;
}): Promise<{ checkedAt: string; offers: Offer[] }> {
  const checkedAt = new Date();
  const apiUrl = options.liveApiUrl.replace(/\/$/, "");
  const points = buildSearchPoints(
    options.centerLat,
    options.centerLon,
    options.radiusKm,
  );
  const searches = await mapWithConcurrency(points, MAX_CONCURRENT_REQUESTS, (point) =>
    searchAround(apiUrl, point),
  );

  const uniqueStations = new Map<number, LiveStation>();
  for (const station of searches.flat()) uniqueStations.set(station.id, station);

  const candidates = [...uniqueStations.values()]
    .filter(
      (station) =>
        !options.requireTodayUpdate || isTodayInRome(station.insertDate, checkedAt),
    )
    .map((station) => stationToOffer(station, options.centerLat, options.centerLon))
    .filter((offer): offer is Offer => Boolean(offer))
    .filter((offer) => offer.distanceKm <= options.radiusKm)
    .sort((a, b) => a.price - b.price || a.distanceKm - b.distanceKm)
    // Ogni candidato costa una richiesta di dettaglio: teniamo un margine sui
    // risultati richiesti senza allargare troppo la coda verso l'API.
    .slice(0, Math.max(options.maxResults * 2, 10));

  const enriched = await mapWithConcurrency(candidates, MAX_CONCURRENT_REQUESTS, (offer) =>
    enrichOffer(apiUrl, offer),
  );
  const offers = enriched
    // La modalità rigorosa chiede che il gestore abbia comunicato oggi: la data
    // di validità del prezzo può essere anteriore anche quando la
    // comunicazione dell'impianto è odierna, quindi bastano l'una o l'altra.
    .filter(
      (offer) =>
        !options.requireTodayUpdate ||
        isTodayInRome(offer.communicatedAt, checkedAt) ||
        isTodayInRome(uniqueStations.get(Number(offer.id))?.insertDate, checkedAt),
    )
    .sort((a, b) => a.price - b.price || a.distanceKm - b.distanceKm)
    .slice(0, options.maxResults);

  return { checkedAt: checkedAt.toISOString(), offers };
}
