export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  location?: { latitude: number; longitude: number };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export type ReplyMarkup = Record<string, unknown>;

export async function telegramRequest<T>(options: {
  botToken: string;
  method: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${options.botToken}/${options.method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.payload ?? {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 35_000),
    },
  );

  const result = (await response.json()) as TelegramResponse<T>;
  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram ${options.method}: ${result.description ?? `errore HTTP ${response.status}`}`,
    );
  }
  return result.result as T;
}

export async function sendTelegramMessage(options: {
  botToken: string;
  chatId: string | number;
  text: string;
  replyMarkup?: ReplyMarkup;
  parseMode?: "HTML" | "MarkdownV2";
}): Promise<void> {
  await telegramRequest({
    botToken: options.botToken,
    method: "sendMessage",
    payload: {
      chat_id: options.chatId,
      text: options.text,
      parse_mode: options.parseMode ?? "HTML",
      disable_web_page_preview: true,
      reply_markup: options.replyMarkup,
    },
  });
}

export async function getTelegramUpdates(options: {
  botToken: string;
  offset?: number;
}): Promise<TelegramUpdate[]> {
  return telegramRequest<TelegramUpdate[]>({
    botToken: options.botToken,
    method: "getUpdates",
    payload: {
      offset: options.offset,
      timeout: 25,
      allowed_updates: ["message", "callback_query"],
    },
    timeoutMs: 32_000,
  });
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await telegramRequest({
    botToken,
    method: "answerCallbackQuery",
    payload: { callback_query_id: callbackQueryId, text },
  });
}

export async function preparePollingBot(botToken: string): Promise<void> {
  await telegramRequest({
    botToken,
    method: "deleteWebhook",
    payload: { drop_pending_updates: false },
  });
  await telegramRequest({
    botToken,
    method: "setMyCommands",
    payload: {
      commands: [
        { command: "start", description: "Configura gli alert" },
        { command: "posizione", description: "Cambia posizione" },
        { command: "soglia", description: "Cambia prezzo massimo" },
        { command: "raggio", description: "Cambia raggio di ricerca" },
        { command: "orari", description: "Cambia gli orari" },
        { command: "controlla", description: "Controlla i prezzi ora" },
        { command: "stato", description: "Mostra la configurazione" },
        { command: "pausa", description: "Sospendi gli alert" },
        { command: "attiva", description: "Riattiva gli alert" },
      ],
    },
  });
}
