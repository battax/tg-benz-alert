import { buildMessage, shouldNotify } from "./alert.js";
import { config, validateConfig } from "./config.js";
import { fetchOffers } from "./mimit.js";
import { readState, writeState } from "./state.js";
import { sendTelegramMessage } from "./telegram.js";
import { appendPriceSample, effectiveThreshold } from "./threshold.js";

export async function runCheck(): Promise<void> {
  validateConfig();
  const now = new Date().toISOString();
  console.log(`[${now}] Controllo prezzi MIMIT...`);

  const [{ offers, checkedAt }, state] = await Promise.all([
    fetchOffers({
      liveApiUrl: config.liveApiUrl,
      centerLat: config.centerLat,
      centerLon: config.centerLon,
      radiusKm: config.radiusKm,
      maxResults: config.maxResults,
      requireTodayUpdate: config.requireTodayUpdate,
    }),
    readState(config.stateFile),
  ]);

  const best = offers[0];
  if (!best) {
    await writeState(config.stateFile, { ...state, lastRunAt: now, lastDatasetDate: checkedAt });
    console.warn("Nessun prezzo benzina self trovato nel raggio configurato.");
    return;
  }

  const threshold = effectiveThreshold({
    mode: config.thresholdMode,
    fixed: config.priceThreshold,
    history: state.priceHistory,
  });
  const belowThreshold = best.price <= threshold.value;
  const notify = shouldNotify({
    state,
    best,
    threshold: threshold.value,
    minDrop: config.minPriceDrop,
  });

  console.log(
    `Migliore: ${best.price.toFixed(3)} €/l — ${best.name || best.brand} (${best.distanceKm.toFixed(1)} km)`,
  );

  let nextState = {
    ...state,
    lastRunAt: now,
    lastDatasetDate: checkedAt,
    lastWasBelow: belowThreshold,
    priceHistory: appendPriceSample(state.priceHistory, best.price, checkedAt),
  };

  if (notify) {
    const text = buildMessage({
      offers: offers.slice(0, config.maxResults),
      threshold: threshold.value,
      checkedAt,
      ...(threshold.auto ? { autoSamples: threshold.samples } : {}),
    });

    if (config.dryRun) console.log(`\n--- DRY RUN ---\n${text}\n---------------`);
    else await sendTelegramMessage({ botToken: config.telegramBotToken, chatId: config.telegramChatId, text });

    // La simulazione non deve consumare l'alert: al successivo avvio reale
    // lo stesso affare deve poter essere inviato a Telegram.
    if (!config.dryRun) {
      nextState = {
        ...nextState,
        lastAlertPrice: best.price,
        lastAlertStationId: best.id,
        lastAlertAt: now,
      };
    }
    console.log(config.dryRun ? "Alert simulato." : "Alert inviato a Telegram.");
  } else {
    console.log(belowThreshold ? "Alert già inviato o variazione insufficiente." : "Prezzo sopra soglia: nessun alert.");
  }

  await writeState(config.stateFile, nextState);
}
