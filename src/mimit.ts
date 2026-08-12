import { distanceKm } from "./geo.js";
import type { Offer } from "./types.js";

const LIVE_SEARCH_RADIUS_KM = 10;

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      "user-agent": "telegram-benzina-alert/1.1",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`API live MIMIT non disponibile (${response.status})`);
  return (await response.json()) as T;
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
  const searches = await Promise.all(points.map((point) => searchAround(apiUrl, point)));

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
    .slice(0, Math.max(options.maxResults * 4, 12));

  const enriched = await Promise.all(
    candidates.map((offer) => enrichOffer(apiUrl, offer)),
  );
  const offers = enriched
    .filter(
      (offer) =>
        !options.requireTodayUpdate || isTodayInRome(offer.communicatedAt, checkedAt),
    )
    .sort((a, b) => a.price - b.price || a.distanceKm - b.distanceKm)
    .slice(0, options.maxResults);

  return { checkedAt: checkedAt.toISOString(), offers };
}
