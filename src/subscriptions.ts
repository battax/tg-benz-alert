import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Subscriber, SubscriberDatabase } from "./types.js";

const EMPTY_DATABASE: SubscriberDatabase = { subscribers: [] };

export const SUBSCRIBER_DEFAULTS = {
  radiusKm: 10,
  threshold: 1.93,
  thresholdMode: "fixed",
  hours: [7, 22],
  enabled: true,
  requireTodayUpdate: true,
} as const;

/**
 * Il file su disco è stato scritto da versioni precedenti del bot: un campo
 * aggiunto oggi arriverebbe `undefined` per chi è già iscritto, pur essendo
 * obbligatorio nei tipi. Qui riportiamo ogni riga alla forma corrente.
 */
export function normalizeSubscriber(raw: unknown): Subscriber | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Partial<Subscriber>;
  if (typeof candidate.chatId !== "number" || typeof candidate.userId !== "number") {
    return undefined;
  }

  const now = new Date().toISOString();
  const hours = Array.isArray(candidate.hours)
    ? candidate.hours.filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    : [];

  return {
    ...candidate,
    chatId: candidate.chatId,
    userId: candidate.userId,
    radiusKm:
      typeof candidate.radiusKm === "number" && candidate.radiusKm > 0
        ? candidate.radiusKm
        : SUBSCRIBER_DEFAULTS.radiusKm,
    threshold:
      typeof candidate.threshold === "number" && candidate.threshold > 0
        ? candidate.threshold
        : SUBSCRIBER_DEFAULTS.threshold,
    thresholdMode: candidate.thresholdMode === "auto" ? "auto" : SUBSCRIBER_DEFAULTS.thresholdMode,
    hours: hours.length ? [...new Set(hours)].sort((a, b) => a - b) : [...SUBSCRIBER_DEFAULTS.hours],
    enabled: candidate.enabled ?? SUBSCRIBER_DEFAULTS.enabled,
    requireTodayUpdate: candidate.requireTodayUpdate ?? SUBSCRIBER_DEFAULTS.requireTodayUpdate,
    priceHistory: Array.isArray(candidate.priceHistory)
      ? candidate.priceHistory.filter(
          (sample) =>
            typeof sample?.at === "string" &&
            typeof sample.price === "number" &&
            Number.isFinite(sample.price),
        )
      : [],
    createdAt: candidate.createdAt ?? now,
    updatedAt: candidate.updatedAt ?? now,
  };
}

export class SubscriptionStore {
  private database: SubscriberDatabase = structuredClone(EMPTY_DATABASE);
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as SubscriberDatabase;
      const rows: unknown[] = Array.isArray(parsed.subscribers) ? parsed.subscribers : [];
      const subscribers = rows
        .map((row) => normalizeSubscriber(row))
        .filter((row): row is Subscriber => row !== undefined);

      const discarded = rows.length - subscribers.length;
      if (discarded > 0) console.warn(`${discarded} iscritti non validi ignorati in ${this.path}.`);
      this.database = { subscribers };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  list(): Subscriber[] {
    return structuredClone(this.database.subscribers);
  }

  get(chatId: number): Subscriber | undefined {
    const found = this.database.subscribers.find((item) => item.chatId === chatId);
    return found ? structuredClone(found) : undefined;
  }

  async upsertIdentity(identity: {
    chatId: number;
    userId: number;
    username?: string;
    firstName?: string;
  }): Promise<Subscriber> {
    const now = new Date().toISOString();
    const existing = this.database.subscribers.find((item) => item.chatId === identity.chatId);

    if (existing) {
      Object.assign(existing, identity, { updatedAt: now });
      await this.persist();
      return structuredClone(existing);
    }

    const subscriber: Subscriber = {
      ...identity,
      ...SUBSCRIBER_DEFAULTS,
      hours: [...SUBSCRIBER_DEFAULTS.hours],
      createdAt: now,
      updatedAt: now,
    };
    this.database.subscribers.push(subscriber);
    await this.persist();
    return structuredClone(subscriber);
  }

  async update(chatId: number, patch: Partial<Subscriber>): Promise<Subscriber | undefined> {
    const subscriber = this.database.subscribers.find((item) => item.chatId === chatId);
    if (!subscriber) return undefined;
    Object.assign(subscriber, patch, { chatId, updatedAt: new Date().toISOString() });
    await this.persist();
    return structuredClone(subscriber);
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.database, null, 2);
    this.persistQueue = this.persistQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, `${snapshot}\n`, "utf8");
      await rename(temporary, this.path);
    });
    return this.persistQueue;
  }
}
