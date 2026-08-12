import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Subscriber, SubscriberDatabase } from "./types.js";

const EMPTY_DATABASE: SubscriberDatabase = { subscribers: [] };

export class SubscriptionStore {
  private database: SubscriberDatabase = structuredClone(EMPTY_DATABASE);
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as SubscriberDatabase;
      this.database = {
        subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
      };
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
      radiusKm: 10,
      threshold: 1.93,
      hours: [7, 22],
      enabled: true,
      requireTodayUpdate: true,
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
