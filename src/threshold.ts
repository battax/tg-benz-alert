import type { PriceSample, ThresholdMode } from "./types.js";

/**
 * Una soglia fissa invecchia: se il mercato sale sopra 1,930 €/l gli alert
 * spariscono, se scende arrivano tutti i giorni. In modalità automatica la
 * soglia diventa il trentesimo percentile dei prezzi migliori rilevati nelle
 * ultime due settimane: "oggi è tra i giorni più convenienti del periodo",
 * una domanda che resta sensata a qualsiasi livello di prezzo.
 */
export const HISTORY_DAYS = 14;
export const MAX_SAMPLES = 90;
export const MIN_SAMPLES_FOR_AUTO = 6;
export const AUTO_PERCENTILE = 0.3;

const DAY_MS = 86_400_000;

function timestamp(sample: PriceSample): number {
  return new Date(sample.at).getTime();
}

function isUsable(sample: PriceSample, cutoff: number): boolean {
  const time = timestamp(sample);
  return Number.isFinite(sample.price) && sample.price > 0 && Number.isFinite(time) && time >= cutoff;
}

export function recentPrices(history: PriceSample[] | undefined, now = new Date()): number[] {
  const cutoff = now.getTime() - HISTORY_DAYS * DAY_MS;
  return (history ?? []).filter((sample) => isUsable(sample, cutoff)).map((sample) => sample.price);
}

export function appendPriceSample(
  history: PriceSample[] | undefined,
  price: number,
  at: string,
  now = new Date(),
): PriceSample[] {
  const cutoff = now.getTime() - HISTORY_DAYS * DAY_MS;
  return [...(history ?? []), { at, price }]
    .filter((sample) => isUsable(sample, cutoff))
    .sort((a, b) => timestamp(a) - timestamp(b))
    .slice(-MAX_SAMPLES);
}

export function percentile(values: number[], ratio: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

export interface EffectiveThreshold {
  /** Valore da confrontare con il prezzo migliore. */
  value: number;
  /** `true` solo se calcolato davvero dallo storico. */
  auto: boolean;
  /** Rilevazioni utili nel periodo, anche quando non bastano. */
  samples: number;
}

export function effectiveThreshold(options: {
  mode?: ThresholdMode;
  fixed: number;
  history?: PriceSample[];
  now?: Date;
}): EffectiveThreshold {
  const prices = recentPrices(options.history, options.now);
  if (options.mode !== "auto" || prices.length < MIN_SAMPLES_FOR_AUTO) {
    // Finché lo storico è corto restiamo sulla soglia scelta a mano: meglio
    // una soglia imperfetta che una calcolata su tre rilevazioni.
    return { value: options.fixed, auto: false, samples: prices.length };
  }

  const value = percentile(prices, AUTO_PERCENTILE) ?? options.fixed;
  return { value: Number(value.toFixed(3)), auto: true, samples: prices.length };
}
