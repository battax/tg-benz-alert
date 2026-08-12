import { escapeHtml } from "./alert.js";
import { config } from "./config.js";
import { sendTelegramMessage } from "./telegram.js";

/**
 * Quando il MIMIT cambia API o il servizio si guasta, l'unico sintomo è il
 * silenzio — indistinguibile da "nessun prezzo sotto soglia". Qui contiamo i
 * fallimenti consecutivi per ambito e avvisiamo l'amministratore, una volta
 * sola finché il guasto dura, con un messaggio di rientro quando passa.
 */
const FAILURES_BEFORE_ALERT = 2;
const COOLDOWN_MS = 30 * 60_000;

interface ScopeHealth {
  failures: number;
  notifiedAt?: number;
}

const scopes = new Map<string, ScopeHealth>();

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return escapeHtml(text.slice(0, 300));
}

async function notifyAdmin(text: string): Promise<void> {
  if (!config.adminChatId || config.dryRun) return;
  try {
    await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.adminChatId,
      text,
    });
  } catch (error) {
    console.error("Avviso all'amministratore non inviato:", error);
  }
}

export async function reportFailure(scope: string, error: unknown): Promise<void> {
  const health = scopes.get(scope) ?? { failures: 0 };
  health.failures += 1;
  scopes.set(scope, health);
  console.error(`${scope}: ${health.failures} fallimenti consecutivi.`);

  if (health.failures < FAILURES_BEFORE_ALERT) return;
  const now = Date.now();
  if (health.notifiedAt !== undefined && now - health.notifiedAt < COOLDOWN_MS) return;

  health.notifiedAt = now;
  await notifyAdmin(
    [
      `⚠️ <b>${escapeHtml(scope)}</b>`,
      `${health.failures} tentativi falliti di fila.`,
      `<code>${describe(error)}</code>`,
    ].join("\n"),
  );
}

export async function reportSuccess(scope: string): Promise<void> {
  const health = scopes.get(scope);
  scopes.set(scope, { failures: 0 });
  if (!health || health.notifiedAt === undefined) return;
  await notifyAdmin(`✅ <b>${escapeHtml(scope)}</b>: tornato a funzionare.`);
}

/** Solo per i test: azzera lo stato accumulato in memoria. */
export function resetHealth(): void {
  scopes.clear();
}
