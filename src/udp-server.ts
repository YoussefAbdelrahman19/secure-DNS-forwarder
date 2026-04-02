import dgram from "node:dgram";
import type { JsonLogger } from "./json-logger.js";
import type { QueryProcessor } from "./query-processor.js";

interface QueueItem {
  msg: Buffer;
  rinfo: dgram.RemoteInfo;
}

class AsyncQueue<T> {
  private readonly items: T[] = [];
  private waiters: Array<(v: T) => void> = [];

  push(item: T): void {
    const w = this.waiters.shift();
    if (w) w(item);
    else this.items.push(item);
  }

  async pop(): Promise<T> {
    const i = this.items.shift();
    if (i !== undefined) return i;
    return new Promise<T>((resolve) => this.waiters.push(resolve));
  }
}

export class UdpServer {
  private socket: dgram.Socket | null = null;
  private running = false;
  private readonly queue = new AsyncQueue<QueueItem>();

  constructor(
    private readonly bindAddress: string,
    private readonly port: number,
    private readonly workerCount: number,
    private readonly processor: QueryProcessor,
    private readonly logger: JsonLogger,
    private readonly maxUdpPacketSize: number,
  ) {}

  start(): void {
    this.running = true;
    this.socket = dgram.createSocket("udp4");

    this.socket.on("error", (err) => {
      this.logger.error({ event: "udp_listener_error", error_class: err.constructor.name, error: String(err.message) });
    });

    this.socket.on("message", (msg, rinfo) => {
      if (!this.running) return;
      this.queue.push({ msg, rinfo });
    });

    this.socket.bind(this.port, this.bindAddress, () => {
      this.logger.info({
        event: "udp_server_started",
        bind_address: this.bindAddress,
        port: this.port,
        workers: this.workerCount,
      });
    });

    for (let i = 0; i < this.workerCount; i++) {
      void this.workerLoop();
    }
  }

  stop(): void {
    this.running = false;
    this.socket?.close();
    this.socket = null;
  }

  private async workerLoop(): Promise<void> {
    while (this.running) {
      try {
        const { msg, rinfo } = await this.queue.pop();
        const clientIp = rinfo.address;
        const response = await this.processor.process(msg, "udp", clientIp);
        if (!response.length) continue;
        this.socket?.send(response, rinfo.port, rinfo.address);
      } catch (e) {
        if (!this.running) break;
        this.logger.error({
          event: "udp_worker_error",
          error_class: e instanceof Error ? e.constructor.name : "Error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
}
