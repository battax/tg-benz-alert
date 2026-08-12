import "dotenv/config";

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} deve essere un numero valido`);
  }
  return value;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? "";

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId,
  channelAlertEnabled: booleanFromEnv("CHANNEL_ALERT_ENABLED", Boolean(telegramChatId)),
  centerLat: numberFromEnv("CENTER_LAT", 44.9969),
  centerLon: numberFromEnv("CENTER_LON", 9.66388),
  radiusKm: numberFromEnv("RADIUS_KM", 15),
  priceThreshold: numberFromEnv("PRICE_THRESHOLD", 1.93),
  minPriceDrop: numberFromEnv("MIN_PRICE_DROP", 0.005),
  maxResults: Math.max(1, Math.round(numberFromEnv("MAX_RESULTS", 5))),
  requireTodayUpdate: booleanFromEnv("REQUIRE_TODAY_UPDATE", true),
  cronSchedule: process.env.CRON_SCHEDULE ?? "0 7,22 * * *",
  userSchedulerCron: process.env.USER_SCHEDULER_CRON ?? "* * * * *",
  timezone: process.env.TIMEZONE ?? "Europe/Rome",
  runOnStart: booleanFromEnv("RUN_ON_START", false),
  dryRun: booleanFromEnv("DRY_RUN", false),
  stateFile: process.env.STATE_FILE ?? "./data/state.json",
  subscribersFile: process.env.SUBSCRIBERS_FILE ?? "./data/subscribers.json",
  botStateFile: process.env.BOT_STATE_FILE ?? "./data/bot-state.json",
  liveApiUrl:
    process.env.MIMIT_LIVE_API_URL ?? "https://carburanti.mise.gov.it/ospzApi",
};

export function validateConfig(): void {
  if (config.radiusKm <= 0) throw new Error("RADIUS_KM deve essere maggiore di zero");
  if (config.radiusKm > 20) throw new Error("RADIUS_KM non può superare 20 con la ricerca live");
  if (config.priceThreshold <= 0) throw new Error("PRICE_THRESHOLD non valida");
  if (config.dryRun) return;
  if (!config.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN mancante");
  if (config.channelAlertEnabled && !config.telegramChatId) {
    throw new Error("TELEGRAM_CHAT_ID mancante mentre CHANNEL_ALERT_ENABLED è attivo");
  }
}
