import cron from "node-cron";
import { startBotPolling } from "./bot.js";
import { config, validateConfig } from "./config.js";
import { reportFailure, reportSuccess } from "./health.js";
import { runCheck } from "./job.js";
import { runSubscriberChecks } from "./subscriber-job.js";
import { SubscriptionStore } from "./subscriptions.js";

const CHANNEL_SCOPE = "Alert canale";

let channelRunning = false;
let subscribersRunning = false;

async function guardedChannelRun(): Promise<void> {
  if (channelRunning) {
    console.warn("Controllo canale precedente ancora in corso: esecuzione saltata.");
    return;
  }
  channelRunning = true;
  try {
    await runCheck();
    await reportSuccess(CHANNEL_SCOPE);
  } catch (error) {
    console.error("Controllo canale fallito:", error);
    await reportFailure(CHANNEL_SCOPE, error);
  } finally {
    channelRunning = false;
  }
}

async function main(): Promise<void> {
  validateConfig();
  if (!cron.validate(config.userSchedulerCron)) {
    throw new Error(`USER_SCHEDULER_CRON non valida: ${config.userSchedulerCron}`);
  }
  if (config.channelAlertEnabled && !cron.validate(config.cronSchedule)) {
    throw new Error(`CRON_SCHEDULE non valida: ${config.cronSchedule}`);
  }

  const store = new SubscriptionStore(config.subscribersFile);
  await store.init();

  const guardedSubscriberRun = async (): Promise<void> => {
    if (subscribersRunning) return;
    subscribersRunning = true;
    try {
      await runSubscriberChecks(store);
    } catch (error) {
      console.error("Scheduler utenti fallito:", error);
    } finally {
      subscribersRunning = false;
    }
  };

  cron.schedule(config.userSchedulerCron, guardedSubscriberRun, {
    timezone: config.timezone,
  });
  console.log(`Scheduler utenti attivo: ${config.userSchedulerCron} (${config.timezone})`);

  if (config.channelAlertEnabled) {
    cron.schedule(config.cronSchedule, guardedChannelRun, { timezone: config.timezone });
    console.log(`Alert canale attivo: ${config.cronSchedule} (${config.timezone})`);
    if (config.runOnStart) void guardedChannelRun();
  } else {
    console.log("Alert canale disattivato; restano attivi gli alert privati personalizzati.");
  }

  await guardedSubscriberRun();
  await startBotPolling(store);
}

main().catch((error) => {
  console.error("Avvio fallito:", error);
  process.exitCode = 1;
});
