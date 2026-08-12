import type { AlertState, Offer } from "./types.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatPrice(price: number): string {
  return price.toFixed(3).replace(".", ",");
}

function mapsUrl(offer: Offer): string {
  const query = `${offer.latitude},${offer.longitude}`;
  return `https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(query)}`;
}

function shortUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed);
  }
  const match = value.match(/^(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))/);
  if (!match) return value;
  return `${match[1]} ${match[2]}`;
}

export function shouldNotify(options: {
  state: AlertState;
  best: Offer;
  threshold: number;
  minDrop: number;
}): boolean {
  const { state, best, threshold, minDrop } = options;
  if (best.price > threshold) return false;
  if (!state.lastWasBelow || state.lastAlertPrice === undefined) return true;
  if (best.price <= state.lastAlertPrice - minDrop) return true;
  return best.id !== state.lastAlertStationId && best.price <= state.lastAlertPrice;
}

export function buildMessage(options: {
  offers: Offer[];
  threshold: number;
  checkedAt?: string;
  mode?: "alert" | "check";
}): string {
  const best = options.offers[0];
  if (!best) throw new Error("Nessuna offerta da mostrare");

  const recommendedAmount =
    best.price <= 1.93
      ? "conviene fare il pieno"
      : best.price <= 1.96
        ? "conviene mettere 40 €"
        : best.price <= 2
          ? "conviene mettere 25–30 €"
          : "conviene mettere solo il necessario";
  const lines = options.offers.map((offer, index) => {
    const label = escapeHtml(offer.name || offer.brand || "Distributore");
    const address = escapeHtml([offer.address, offer.city].filter(Boolean).join(", "));
    const updated = offer.communicatedAt ? ` · agg. ${escapeHtml(shortUpdatedAt(offer.communicatedAt))}` : "";
    const location = address ? `${address} · ` : "";
    return `${index + 1}. <b>${formatPrice(offer.price)} €/l</b> — ${label}\n   ${location}${offer.distanceKm.toFixed(1).replace(".", ",")} km${updated} · <a href="${mapsUrl(offer)}">mappa</a>`;
  });

  return [
    options.mode === "check"
      ? "🔎 <b>PREZZI BENZINA VICINO A TE</b>"
      : "⛽ <b>BENZINA CONVENIENTE</b>",
    "",
    ...lines,
    "",
    `🚗 Per la tua Fabia: <b>${recommendedAmount}</b>.`,
    `🎯 Soglia impostata: ${formatPrice(options.threshold)} €/l`,
    options.checkedAt
      ? `🟢 Verifica live MIMIT: ${escapeHtml(shortUpdatedAt(options.checkedAt))}`
      : "🟢 Fonte: Osservaprezzi MIMIT live",
  ]
    .filter(Boolean)
    .join("\n");
}
