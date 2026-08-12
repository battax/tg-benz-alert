import { buildMessage, shouldNotify } from "./alert.js";
import { config } from "./config.js";
import { fetchOffers } from "./mimit.js";
import { SubscriptionStore } from "./subscriptions.js";
import { sendTelegramMessage } from "./telegram.js";
import type { Subscriber } from "./types.js";

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

  const belowThreshold = best.price <= subscriber.threshold;
  const notify = shouldNotify({
    state: subscriber,
    best,
    threshold: subscriber.threshold,
    minDrop: config.minPriceDrop,
  });

  const patch: Partial<Subscriber> = { lastWasBelow: belowThreshold };
  if (notify) {
    const interesting = offers
      .filter((offer) => offer.price <= subscriber.threshold)
      .slice(0, config.maxResults);
    await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: subscriber.chatId,
      text: buildMessage({
        offers: interesting,
        threshold: subscriber.threshold,
        checkedAt,
      }),
    });
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

  for (const subscriber of subscribers) {
    try {
      await checkSubscriber(store, subscriber);
      await store.update(subscriber.chatId, { lastCheckKey: slot.key });
    } catch (error) {
      // Non registriamo lo slot: lo scheduler potrà riprovare al minuto successivo.
      console.error(`Controllo utente ${subscriber.chatId} fallito:`, error);
    }
  }
}
