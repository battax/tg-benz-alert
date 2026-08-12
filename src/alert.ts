import type { AlertState, Offer } from "./types.js";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatPrice(price: number): string {
  return price.toFixed(3).replace(".", ",");
}

const RANK_EMOJI = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

function rankLabel(index: number): string {
  return RANK_EMOJI[index] ?? `${index + 1}.`;
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

/**
 * Il consiglio è relativo alla soglia dell'utente, non a prezzi assoluti
 * scritti nel codice: resta valido anche quando il mercato si sposta.
 */
export function buildAdvice(price: number, threshold: number): string {
  const gap = threshold - price;
  if (gap >= 0.04) return "occasione ottima, conviene fare il pieno";
  if (gap >= 0.015) return "buon prezzo, conviene un rifornimento abbondante";
  if (gap >= 0) return "prezzo in linea con la tua soglia, metti quanto ti serve";
  return "sopra la tua soglia, meglio solo il necessario";
}

export function buildMessage(options: {
  offers: Offer[];
  threshold: number;
  checkedAt?: string;
  mode?: "alert" | "check";
  /** Rilevazioni usate per la soglia automatica; assente se soglia fissa. */
  autoSamples?: number;
}): string {
  const best = options.offers[0];
  if (!best) throw new Error("Nessuna offerta da mostrare");
  const lines = options.offers.map((offer, index) => {
    const label = escapeHtml(offer.name || offer.brand || "Distributore");
    const address = escapeHtml([offer.address, offer.city].filter(Boolean).join(", "));
    const updated = offer.communicatedAt ? ` · agg. ${escapeHtml(shortUpdatedAt(offer.communicatedAt))}` : "";
    const location = address ? `${address} · ` : "";
    // I distributori oltre soglia restano in lista come confronto, marcati.
    const marker = offer.price <= options.threshold ? "✅" : "🔸";
    return `${rankLabel(index)} <b>${formatPrice(offer.price)} €/l</b> ${marker} — <b>${label}</b>\n   ${location}${offer.distanceKm.toFixed(1).replace(".", ",")} km${updated} · <a href="${mapsUrl(offer)}">mappa</a>`;
  });

  return [
    options.mode === "check"
      ? "🔎 <b>PREZZI BENZINA VICINO A TE</b>"
      : "⛽ <b>BENZINA CONVENIENTE</b>",
    "",
    ...lines,
    "",
    `🚗 <b>${buildAdvice(best.price, options.threshold)}</b>.`,
    options.autoSamples === undefined
      ? `🎯 Soglia impostata: ${formatPrice(options.threshold)} €/l (✅ sotto soglia, 🔸 sopra)`
      : `🎯 Soglia automatica: ${formatPrice(options.threshold)} €/l, dai prezzi migliori delle ultime due settimane (${options.autoSamples} rilevazioni)`,
    options.checkedAt
      ? `🟢 Verifica live MIMIT: ${escapeHtml(shortUpdatedAt(options.checkedAt))}`
      : "🟢 Fonte: Osservaprezzi MIMIT live",
  ]
    .filter(Boolean)
    .join("\n");
}
