import { buildMessage, shouldNotify } from "./alert.js";
import { config } from "./config.js";
import { reportFailure, reportSuccess } from "./health.js";
import { fetchOffers } from "./mimit.js";
import { SubscriptionStore } from "./subscriptions.js";
import { isUnreachableChat, sendTelegramMessage } from "./telegram.js";
import { appendPriceSample, effectiveThreshold } from "./threshold.js";
import type { Subscriber } from "./types.js";

const USER_SCOPE = "Controllo prezzi utenti";

export interface ScheduleSlot {
  date: string;
  hour: number;
  key: string;
}

export function getRomeScheduleSlot(now = new Date()): ScheduleSlot {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const hour = Number(value("hour"));
  return { date, hour, key: `${date}-${String(hour).padStart(2, "0")}` };
}

async function checkSubscriber(store: SubscriptionStore, subscriber: Subscriber): Promise<void> {
  if (subscriber.latitude === undefined || subscriber.longitude === undefined) return;

  const { offers, checkedAt } = await fetchOffers({
    liveApiUrl: config.liveApiUrl,
    centerLat: subscriber.latitude,
    centerLon: subscriber.longitude,
    radiusKm: subscriber.radiusKm,
    maxResults: config.maxResults,
    requireTodayUpdate: subscriber.requireTodayUpdate,
  });
  const best = offers[0];

  if (!best) {
    await store.update(subscriber.chatId, { lastWasBelow: false });
    console.log(`Utente ${subscriber.chatId}: nessun prezzo odierno nel raggio.`);
    return;
  }

  const threshold = effectiveThreshold({
    mode: subscriber.thresholdMode,
    fixed: subscriber.threshold,
    history: subscriber.priceHistory,
  });
  const belowThreshold = best.price <= threshold.value;
  const notify = shouldNotify({
    state: subscriber,
    best,
    threshold: threshold.value,
    minDrop: config.minPriceDrop,
  });

  // Lo storico si alimenta con i controlli programmati, non con quelli
  // manuali: serve un campionamento regolare perché il percentile abbia senso.
  const patch: Partial<Subscriber> = {
    lastWasBelow: belowThreshold,
    priceHistory: appendPriceSample(subscriber.priceHistory, best.price, checkedAt),
  };
  if (notify) {
    // L'alert scatta sul migliore sotto soglia, ma elenchiamo comunque tutti i
    // distributori trovati: servono come confronto immediato.
    try {
      await sendTelegramMessage({
        botToken: config.telegramBotToken,
        chatId: subscriber.chatId,
        text: buildMessage({
          offers: offers.slice(0, config.maxResults),
          threshold: threshold.value,
          checkedAt,
          ...(threshold.auto ? { autoSamples: threshold.samples } : {}),
        }),
      });
    } catch (error) {
      // Chi ha bloccato il bot va sospeso: senza questo, ogni minuto della
      // sua fascia oraria rifaremmo una ricerca completa per un invio certo
      // di fallire. Riparte da solo appena riscrive al bot.
      if (!isUnreachableChat(error)) throw error;
      await store.update(subscriber.chatId, { enabled: false });
      console.warn(`Utente ${subscriber.chatId} irraggiungibile: alert sospesi.`);
      return;
    }
    patch.lastAlertPrice = best.price;
    patch.lastAlertStationId = best.id;
    console.log(`Alert privato inviato all'utente ${subscriber.chatId}.`);
  }

  await store.update(subscriber.chatId, patch);
}

export async function runSubscriberChecks(
  store: SubscriptionStore,
  now = new Date(),
): Promise<void> {
  const slot = getRomeScheduleSlot(now);
  const subscribers = store
    .list()
    .filter(
      (subscriber) =>
        subscriber.enabled &&
        subscriber.latitude !== undefined &&
        subscriber.longitude !== undefined &&
        subscriber.hours.includes(slot.hour) &&
        subscriber.lastCheckKey !== slot.key,
    );

  let succeeded = 0;
  let lastError: unknown;

  for (const subscriber of subscribers) {
    try {
      await checkSubscriber(store, subscriber);
      await store.update(subscriber.chatId, { lastCheckKey: slot.key });
      succeeded += 1;
    } catch (error) {
      // Non registriamo lo slot: lo scheduler potrà riprovare al minuto successivo.
      lastError = error;
      console.error(`Controllo utente ${subscriber.chatId} fallito:`, error);
    }
  }

  if (!subscribers.length) return;
  if (succeeded > 0) await reportSuccess(USER_SCOPE);
  else await reportFailure(USER_SCOPE, lastError);
}
