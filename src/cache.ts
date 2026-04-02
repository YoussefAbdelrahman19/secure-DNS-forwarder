import { Message } from "./dns/message.js";

interface Entry {
  expiresAt: number;
  responseTemplate: Buffer;
}

function nowRealtime(): number {
  return Date.now() / 1000;
}

export class Cache {
  private readonly enabled: boolean;
  private readonly maxEntries: number;
  private readonly minTtlSeconds: number;
  private readonly maxTtlSeconds: number;
  private readonly negativeTtlSeconds: number;
  private readonly store = new Map<string, Entry>();

  constructor(params: {
    enabled: boolean;
    maxEntries: number;
    minTtlSeconds: number;
    maxTtlSeconds: number;
    negativeTtlSeconds: number;
  }) {
    this.enabled = params.enabled;
    this.maxEntries = params.maxEntries;
    this.minTtlSeconds = params.minTtlSeconds;
    this.maxTtlSeconds = params.maxTtlSeconds;
    this.negativeTtlSeconds = params.negativeTtlSeconds;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  fetch(query: Message): Buffer | null {
    if (!this.enabled) return null;
    const key = query.cacheKey();
    const t = nowRealtime();
    this.purgeExpired(t);
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt <= t) return null;
    return this.patchTransactionId(entry.responseTemplate, query.id);
  }

  write(query: Message, response: Message): void {
    if (!this.enabled) return;
    let ttl = response.cacheTtlSeconds(this.negativeTtlSeconds);
    ttl = Math.min(Math.max(ttl, this.minTtlSeconds), this.maxTtlSeconds);
    const expiresAt = nowRealtime() + ttl;
    this.evictIfNeeded();
    this.store.set(query.cacheKey(), {
      expiresAt,
      responseTemplate: this.normalizeTransactionId(Buffer.from(response.raw)),
    });
  }

  private purgeExpired(t: number): void {
    for (const [k, v] of this.store) {
      if (v.expiresAt <= t) this.store.delete(k);
    }
  }

  private evictIfNeeded(): void {
    if (this.store.size < this.maxEntries) return;
    let oldestKey: string | null = null;
    let oldestExp = Infinity;
    for (const [k, v] of this.store) {
      if (v.expiresAt < oldestExp) {
        oldestExp = v.expiresAt;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) this.store.delete(oldestKey);
  }

  private normalizeTransactionId(raw: Buffer): Buffer {
    const data = Buffer.from(raw);
    data.writeUInt16BE(0, 0);
    return data;
  }

  private patchTransactionId(raw: Buffer, id: number): Buffer {
    const data = Buffer.from(raw);
    data.writeUInt16BE(id, 0);
    return data;
  }
}
