import { once } from "node:events";
import tls from "node:tls";
import type { RecordMap } from "../config.js";
import type { JsonLogger } from "../json-logger.js";
import type { Metrics } from "../metrics.js";

type UpstreamConfig = RecordMap;

async function readExact(sock: tls.TLSSocket, length: number, timeoutMs: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  const deadline = Date.now() + timeoutMs;
  while (n < length) {
    const chunk = sock.read(length - n);
    if (chunk) {
      chunks.push(chunk);
      n += chunk.length;
      continue;
    }
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("upstream read timeout");
    try {
      await Promise.race([
        once(sock, "readable"),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("upstream read timeout")), left)),
      ]);
    } catch (e) {
      if (sock.readableEnded) throw new Error("upstream closed connection");
      throw e;
    }
  }
  return Buffer.concat(chunks, length);
}

async function writeAll(sock: tls.TLSSocket, buf: Buffer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("upstream write timeout")), timeoutMs);
    sock.write(buf, (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    });
  });
}

class DoTConnection {
  private sock: tls.TLSSocket | null = null;

  constructor(private readonly cfg: UpstreamConfig) {}

  async query(raw: Buffer): Promise<Buffer> {
    try {
      await this.ensureConnected();
      const sock = this.sock!;
      const writeTimeout = Number(this.cfg.write_timeout_seconds) * 1000;
      const readTimeout = Number(this.cfg.read_timeout_seconds) * 1000;
      const frame = Buffer.allocUnsafe(2 + raw.length);
      frame.writeUInt16BE(raw.length, 0);
      raw.copy(frame, 2);
      await writeAll(sock, frame, writeTimeout);
      const header = await readExact(sock, 2, readTimeout);
      const len = header.readUInt16BE(0);
      return readExact(sock, len, readTimeout);
    } catch (e) {
      this.close();
      throw e;
    }
  }

  close(): void {
    this.sock?.destroy();
    this.sock = null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.sock && !this.sock.destroyed) return;
    this.close();
    const connectMs = Number(this.cfg.connect_timeout_seconds) * 1000;
    const address = String(this.cfg.address);
    const port = Number(this.cfg.port);
    const sni = String(this.cfg.sni_hostname);

    const sock = tls.connect({
      host: address,
      port,
      servername: sni,
      rejectUnauthorized: true,
    });
    this.sock = sock;

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("upstream connect timeout")), connectMs);
      sock.once("secureConnect", () => {
        clearTimeout(t);
        resolve();
      });
      sock.once("error", (err) => {
        clearTimeout(t);
        reject(err);
      });
    });
  }
}

class AsyncQueue<T> {
  private readonly items: T[] = [];
  private waiters: Array<(v: T) => void> = [];

  tryShift(): T | undefined {
    return this.items.shift();
  }

  push(item: T): void {
    const w = this.waiters.shift();
    if (w) w(item);
    else this.items.push(item);
  }

  async pop(): Promise<T> {
    const i = this.tryShift();
    if (i !== undefined) return i;
    return new Promise<T>((resolve) => this.waiters.push(resolve));
  }
}

export class DoTPool {
  private readonly cfg: UpstreamConfig;
  private readonly logger: JsonLogger;
  private readonly metrics: Metrics;
  private readonly queue = new AsyncQueue<DoTConnection>();
  private created = 0;
  private lastFailureAt: number | null = null;
  private createGate = Promise.resolve();

  constructor(cfg: UpstreamConfig, logger: JsonLogger, metrics: Metrics) {
    this.cfg = cfg;
    this.logger = logger;
    this.metrics = metrics;
  }

  get name(): string {
    return String(this.cfg.name);
  }

  available(): boolean {
    if (this.lastFailureAt === null) return true;
    const cd = Number(this.cfg.failure_cooldown_seconds);
    return performance.now() / 1000 - this.lastFailureAt >= cd;
  }

  async query(raw: Buffer): Promise<Buffer> {
    const conn = await this.checkout();
    const started = performance.now() / 1000;
    try {
      const response = await conn.query(raw);
      this.observeSuccess(started);
      return response;
    } catch (e) {
      this.observeFailure(e);
      throw e;
    } finally {
      this.checkin(conn);
    }
  }

  private observeSuccess(started: number): void {
    const latency = performance.now() / 1000 - started;
    this.lastFailureAt = null;
    this.metrics.increment("dnsserve_upstream_queries_total", { upstream: this.name, result: "success" });
    this.metrics.observe("dnsserve_upstream_latency_seconds", latency, { upstream: this.name });
  }

  private observeFailure(err: unknown): void {
    this.lastFailureAt = performance.now() / 1000;
    this.metrics.increment("dnsserve_upstream_queries_total", { upstream: this.name, result: "failure" });
    this.logger.warn({
      event: "upstream_query_failed",
      upstream: this.name,
      error_class: err instanceof Error ? err.constructor.name : "Error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  private async tryCreateConnection(): Promise<DoTConnection | null> {
    const poolSize = Number(this.cfg.pool_size);
    const decision = this.createGate.then((): { make: boolean } => {
      if (this.created < poolSize) {
        this.created += 1;
        return { make: true };
      }
      return { make: false };
    });
    this.createGate = decision.then(
      () => undefined,
      () => undefined,
    );
    const { make } = await decision;
    return make ? new DoTConnection(this.cfg) : null;
  }

  private async checkout(): Promise<DoTConnection> {
    const pooled = this.queue.tryShift();
    if (pooled) return pooled;
    const created = await this.tryCreateConnection();
    if (created) return created;
    return this.queue.pop();
  }

  private checkin(conn: DoTConnection): void {
    this.queue.push(conn);
  }
}
