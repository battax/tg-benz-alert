import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildMessage } from "./alert.js";
import { config } from "./config.js";
import { fetchOffers } from "./mimit.js";
import { SubscriptionStore } from "./subscriptions.js";
import {
  answerCallbackQuery,
  getTelegramUpdates,
  preparePollingBot,
  sendTelegramMessage,
  type ReplyMarkup,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from "./telegram.js";
import type { PendingAction, Subscriber } from "./types.js";

const mainKeyboard: ReplyMarkup = {
  keyboard: [
    [{ text: "📍 Condividi posizione", request_location: true }],
    [{ text: "🎯 Soglia" }, { text: "📏 Raggio" }],
    [{ text: "🕒 Orari" }, { text: "📋 Stato" }],
    [{ text: "🔎 Controlla ora" }, { text: "⏸ Pausa" }, { text: "▶️ Attiva" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

function inlineKeyboard(rows: Array<Array<{ text: string; callback_data: string }>>): ReplyMarkup {
  return { inline_keyboard: rows };
}

function formatPrice(value: number): string {
  return value.toFixed(3).replace(".", ",");
}

export function parseThreshold(text: string): number | undefined {
  const value = Number(text.trim().replace(",", ".").replace(/[€\s]/g, ""));
  return Number.isFinite(value) && value >= 1 && value <= 3 ? value : undefined;
}

export function parseRadius(text: string): number | undefined {
  const value = Number(text.trim().toLowerCase().replace("km", "").trim());
  return Number.isFinite(value) && value >= 1 && value <= 20 ? Math.round(value) : undefined;
}

export function parseHours(text: string): number[] | undefined {
  const values = text
    .split(/[,:;\s]+/)
    .filter(Boolean)
    .map(Number);
  if (!values.length || values.some((value) => !Number.isInteger(value) || value < 0 || value > 23)) {
    return undefined;
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

async function send(chatId: number, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  await sendTelegramMessage({
    botToken: config.telegramBotToken,
    chatId,
    text,
    replyMarkup,
  });
}

async function sendWelcome(subscriber: Subscriber): Promise<void> {
  const positionText =
    subscriber.latitude === undefined
      ? "Per iniziare, premi <b>📍 Condividi posizione</b>."
      : subscriber.enabled
        ? "La tua configurazione è già attiva: puoi modificarla dai pulsanti qui sotto."
        : "I tuoi alert sono in pausa: premi <b>▶️ Attiva</b> per riprenderli.";
  await send(
    subscriber.chatId,
    [
      `Ciao ${subscriber.firstName ?? ""}! 👋`,
      "",
      "Ti avviso quando trovo benzina self conveniente vicino alla posizione che scegli.",
      positionText,
      "",
      "Impostazioni iniziali: soglia <b>1,930 €/l</b>, raggio <b>10 km</b>, orari <b>07:00 e 22:00</b>.",
    ].join("\n"),
    mainKeyboard,
  );
}

async function askPosition(chatId: number): Promise<void> {
  await send(
    chatId,
    "Premi il pulsante qui sotto e autorizza Telegram a condividere la posizione. Puoi inviare anche una posizione diversa da quella attuale usando l'allegato 📎.",
    mainKeyboard,
  );
}

async function askThreshold(chatId: number): Promise<void> {
  await send(
    chatId,
    "Scegli il prezzo massimo che consideri conveniente:",
    inlineKeyboard([
      [
        { text: "1,850 €", callback_data: "threshold:1.85" },
        { text: "1,900 €", callback_data: "threshold:1.90" },
        { text: "1,930 €", callback_data: "threshold:1.93" },
      ],
      [
        { text: "1,950 €", callback_data: "threshold:1.95" },
        { text: "2,000 €", callback_data: "threshold:2.00" },
        { text: "✍️ Personalizzata", callback_data: "threshold:custom" },
      ],
    ]),
  );
}

async function askRadius(chatId: number): Promise<void> {
  await send(
    chatId,
    "Quanto lontano vuoi cercare dalla posizione scelta?",
    inlineKeyboard([
      [5, 10, 15, 20].map((value) => ({
        text: `${value} km`,
        callback_data: `radius:${value}`,
      })),
      [{ text: "✍️ Personalizzato", callback_data: "radius:custom" }],
    ]),
  );
}

async function askHours(chatId: number): Promise<void> {
  await send(
    chatId,
    "Scegli quando controllare i prezzi (ora italiana):",
    inlineKeyboard([
      [
        { text: "07 e 22", callback_data: "hours:7,22" },
        { text: "08 e 20", callback_data: "hours:8,20" },
        { text: "Solo 07", callback_data: "hours:7" },
      ],
      [{ text: "✍️ Personalizzati", callback_data: "hours:custom" }],
    ]),
  );
}

async function sendStatus(subscriber: Subscriber): Promise<void> {
  const position =
    subscriber.latitude === undefined || subscriber.longitude === undefined
      ? "non impostata"
      : `${subscriber.latitude.toFixed(5)}, ${subscriber.longitude.toFixed(5)}`;
  await send(
    subscriber.chatId,
    [
      "📋 <b>LA TUA CONFIGURAZIONE</b>",
      "",
      `Stato: <b>${subscriber.enabled ? "attivo ✅" : "in pausa ⏸"}</b>`,
      `Posizione: <code>${position}</code>`,
      `Raggio: <b>${subscriber.radiusKm} km</b>`,
      `Soglia: <b>${formatPrice(subscriber.threshold)} €/l</b>`,
      `Orari: <b>${subscriber.hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ")}</b>`,
      `Dati: <b>${subscriber.requireTodayUpdate ? "solo prezzi comunicati oggi" : "ultimi prezzi ufficiali"}</b>`,
    ].join("\n"),
    mainKeyboard,
  );
}

async function checkNow(subscriber: Subscriber): Promise<void> {
  if (subscriber.latitude === undefined || subscriber.longitude === undefined) {
    await send(subscriber.chatId, "Prima devi impostare una posizione.", mainKeyboard);
    return;
  }

  await send(subscriber.chatId, "🔄 Controllo i prezzi live MIMIT…");
  let result: Awaited<ReturnType<typeof fetchOffers>>;
  try {
    result = await fetchOffers({
      liveApiUrl: config.liveApiUrl,
      centerLat: subscriber.latitude,
      centerLon: subscriber.longitude,
      radiusKm: subscriber.radiusKm,
      maxResults: config.maxResults,
      requireTodayUpdate: subscriber.requireTodayUpdate,
    });
  } catch (error) {
    console.error(`Controllo manuale utente ${subscriber.chatId} fallito:`, error);
    await send(
      subscriber.chatId,
      "Il servizio prezzi MIMIT non risponde in questo momento. Riprova tra qualche minuto.",
      mainKeyboard,
    );
    return;
  }
  const { offers, checkedAt } = result;

  if (!offers.length) {
    await send(
      subscriber.chatId,
      "Oggi nessun distributore nel raggio scelto ha comunicato un prezzo benzina self. Riprova più tardi.",
      mainKeyboard,
    );
    return;
  }

  await send(
    subscriber.chatId,
    buildMessage({ offers, threshold: subscriber.threshold, checkedAt, mode: "check" }),
    mainKeyboard,
  );
}

async function handlePendingText(
  store: SubscriptionStore,
  subscriber: Subscriber,
  text: string,
): Promise<boolean> {
  if (!subscriber.pendingAction) return false;
  let patch: Partial<Subscriber> | undefined;
  let confirmation = "";

  if (subscriber.pendingAction === "threshold") {
    const threshold = parseThreshold(text);
    if (threshold !== undefined) {
      patch = { threshold, pendingAction: undefined };
      confirmation = `Soglia aggiornata a <b>${formatPrice(threshold)} €/l</b>.`;
    }
  } else if (subscriber.pendingAction === "radius") {
    const radiusKm = parseRadius(text);
    if (radiusKm !== undefined) {
      patch = { radiusKm, pendingAction: undefined };
      confirmation = `Raggio aggiornato a <b>${radiusKm} km</b>.`;
    }
  } else if (subscriber.pendingAction === "hours") {
    const hours = parseHours(text);
    if (hours) {
      patch = { hours, pendingAction: undefined, lastCheckKey: undefined };
      confirmation = `Orari aggiornati: <b>${hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ")}</b>.`;
    }
  }

  if (!patch) {
    await send(
      subscriber.chatId,
      subscriber.pendingAction === "threshold"
        ? "Valore non valido. Scrivi un prezzo tra 1,000 e 3,000, per esempio <code>1,925</code>."
        : subscriber.pendingAction === "radius"
          ? "Valore non valido. Scrivi un raggio tra 1 e 20 km."
          : "Formato non valido. Scrivi le ore separate da virgola, per esempio <code>7,22</code>.",
    );
    return true;
  }

  await store.update(subscriber.chatId, patch);
  await send(subscriber.chatId, confirmation, mainKeyboard);
  return true;
}

async function handleCommand(
  store: SubscriptionStore,
  subscriber: Subscriber,
  command: string,
): Promise<void> {
  if (command === "/start") return sendWelcome(subscriber);
  if (command === "/posizione") return askPosition(subscriber.chatId);
  if (command === "/soglia") return askThreshold(subscriber.chatId);
  if (command === "/raggio") return askRadius(subscriber.chatId);
  if (command === "/orari") return askHours(subscriber.chatId);
  if (command === "/stato") return sendStatus(subscriber);
  if (command === "/controlla") return checkNow(subscriber);
  if (command === "/pausa") {
    await store.update(subscriber.chatId, { enabled: false });
    return send(subscriber.chatId, "Alert sospesi. Puoi riattivarli con /attiva.", mainKeyboard);
  }
  if (command === "/attiva") {
    await store.update(subscriber.chatId, { enabled: true, lastCheckKey: undefined });
    return send(subscriber.chatId, "Alert riattivati ✅", mainKeyboard);
  }
  await send(subscriber.chatId, "Comando non riconosciuto. Usa i pulsanti oppure /stato.", mainKeyboard);
}

async function handleMessage(store: SubscriptionStore, message: TelegramMessage): Promise<void> {
  if (message.chat.type !== "private" || !message.from || message.from.is_bot) return;
  let subscriber = await store.upsertIdentity({
    chatId: message.chat.id,
    userId: message.from.id,
    username: message.from.username,
    firstName: message.from.first_name,
  });

  if (message.location) {
    subscriber = (await store.update(subscriber.chatId, {
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      enabled: true,
      pendingAction: undefined,
      lastCheckKey: undefined,
      lastWasBelow: undefined,
      lastAlertPrice: undefined,
      lastAlertStationId: undefined,
    })) as Subscriber;
    await send(
      subscriber.chatId,
      "Posizione salvata ✅ Gli alert sono attivi. Usa /controlla per una verifica immediata.",
      mainKeyboard,
    );
    return;
  }

  const text = message.text?.trim();
  if (!text) return;
  if (!text.startsWith("/") && (await handlePendingText(store, subscriber, text))) return;

  const buttonCommands: Record<string, string> = {
    "📍 Condividi posizione": "/posizione",
    "🎯 Soglia": "/soglia",
    "📏 Raggio": "/raggio",
    "🕒 Orari": "/orari",
    "📋 Stato": "/stato",
    "🔎 Controlla ora": "/controlla",
    "⏸ Pausa": "/pausa",
    "▶️ Attiva": "/attiva",
  };
  const normalized = buttonCommands[text] ?? text.split(/\s+/)[0]?.split("@")[0] ?? text;
  await handleCommand(store, subscriber, normalized.toLowerCase());
}

async function handleCallback(
  store: SubscriptionStore,
  callback: TelegramCallbackQuery,
): Promise<void> {
  const chatId = callback.message?.chat.id;
  if (!chatId || callback.message?.chat.type !== "private" || !callback.data) return;
  const subscriber = await store.upsertIdentity({
    chatId,
    userId: callback.from.id,
    username: callback.from.username,
    firstName: callback.from.first_name,
  });
  const [type, value] = callback.data.split(":");

  if (value === "custom") {
    const pendingAction = type as PendingAction;
    await store.update(chatId, { pendingAction });
    await answerCallbackQuery(config.telegramBotToken, callback.id);
    await send(
      chatId,
      type === "threshold"
        ? "Scrivi la soglia desiderata, per esempio <code>1,925</code>."
        : type === "radius"
          ? "Scrivi il raggio desiderato da 1 a 20 km."
          : "Scrivi le ore separate da virgola, per esempio <code>7,13,22</code>.",
    );
    return;
  }

  if (type === "threshold") {
    const threshold = parseThreshold(value ?? "");
    if (threshold !== undefined) await store.update(chatId, { threshold, pendingAction: undefined });
  } else if (type === "radius") {
    const radiusKm = parseRadius(value ?? "");
    if (radiusKm !== undefined) await store.update(chatId, { radiusKm, pendingAction: undefined });
  } else if (type === "hours") {
    const hours = parseHours(value ?? "");
    if (hours) await store.update(chatId, { hours, pendingAction: undefined, lastCheckKey: undefined });
  }

  await answerCallbackQuery(config.telegramBotToken, callback.id, "Impostazione salvata");
  await sendStatus(store.get(subscriber.chatId) ?? subscriber);
}

async function readOffset(path: string): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { offset?: number };
    return parsed.offset;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeOffset(path: string, offset: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ offset }, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function handleUpdate(store: SubscriptionStore, update: TelegramUpdate): Promise<void> {
  if (update.message) await handleMessage(store, update.message);
  else if (update.callback_query) await handleCallback(store, update.callback_query);
}

function updateChatId(update: TelegramUpdate): number | undefined {
  return update.message?.chat.id ?? update.callback_query?.message?.chat.id;
}

/**
 * Un `/controlla` interroga il MIMIT per qualche secondo: elaborare gli update
 * in sequenza bloccherebbe tutti gli altri utenti. Ogni chat ha quindi la sua
 * coda, così le sue richieste restano ordinate mentre le chat diverse
 * procedono in parallelo.
 */
const chatQueues = new Map<number, Promise<void>>();

function enqueueChatWork(chatId: number, work: () => Promise<void>): void {
  const previous = chatQueues.get(chatId) ?? Promise.resolve();
  const current = previous.then(work).catch((error) => {
    console.error(`Errore nella chat ${chatId}:`, error);
  });
  chatQueues.set(chatId, current);
  void current.then(() => {
    if (chatQueues.get(chatId) === current) chatQueues.delete(chatId);
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function startBotPolling(store: SubscriptionStore): Promise<never> {
  await preparePollingBot(config.telegramBotToken);
  let offset = await readOffset(config.botStateFile);
  console.log("Bot multiutente in ascolto via long polling.");

  while (true) {
    try {
      const updates = await getTelegramUpdates({ botToken: config.telegramBotToken, offset });
      for (const update of updates) {
        const chatId = updateChatId(update);
        if (chatId === undefined) {
          console.warn(`Update Telegram ${update.update_id} senza chat: ignorato.`);
        } else {
          enqueueChatWork(chatId, () => handleUpdate(store, update));
        }
        offset = update.update_id + 1;
      }
      // L'offset avanza appena l'update è stato preso in carico: Telegram non
      // ce lo ripropone e il polling resta libero di ricevere gli altri.
      if (updates.length > 0 && offset !== undefined) {
        await writeOffset(config.botStateFile, offset);
      }
    } catch (error) {
      console.error("Polling Telegram interrotto, nuovo tentativo tra 5 secondi:", error);
      await wait(5_000);
    }
  }
}
