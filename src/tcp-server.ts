import net from "node:net";
import { once } from "node:events";
import type { JsonLogger } from "./json-logger.js";
import type { QueryProcessor } from "./query-processor.js";

async function readExact(sock: net.Socket, length: number, timeoutSeconds: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (n < length) {
    const chunk = sock.read(length - n);
    if (chunk) {
      chunks.push(chunk);
      n += chunk.length;
      continue;
    }
    const left = deadline - Date.now();
    if (left <= 0) return null;
    try {
      await Promise.race([
        once(sock, "readable"),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), left)),
      ]);
    } catch {
      return null;
    }
  }
  return Buffer.concat(chunks, length);
}

async function readDnsMessage(sock: net.Socket, timeoutSeconds: number): Promise<Buffer | null> {
  const header = await readExact(sock, 2, timeoutSeconds);
  if (!header || header.length < 2) return null;
  const len = header.readUInt16BE(0);
  return readExact(sock, len, timeoutSeconds);
}

async function writeAll(sock: net.Socket, data: Buffer, timeoutSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tcp write timeout")), timeoutSeconds * 1000);
    sock.write(data, (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    });
  });
}

export class TcpServer {
  private server: net.Server | null = null;
  private running = false;

  constructor(
    private readonly bindAddress: string,
    private readonly port: number,
    private readonly backlog: number,
    private readonly clientTimeoutSeconds: number,
    private readonly processor: QueryProcessor,
    private readonly logger: JsonLogger,
  ) {}

  start(): void {
    this.running = true;
    this.server = net.createServer({ backlog: this.backlog }, (client) => {
      void this.handleClient(client);
    });

    this.server.on("error", (err) => {
      this.logger.error({ event: "tcp_accept_error", error_class: err.constructor.name, error: err.message });
    });

    this.server.listen(this.port, this.bindAddress, () => {
      this.logger.info({
        event: "tcp_server_started",
        bind_address: this.bindAddress,
        port: this.port,
        backlog: this.backlog,
      });
    });
  }

  stop(): void {
    this.running = false;
    this.server?.close();
    this.server = null;
  }

  private async handleClient(client: net.Socket): Promise<void> {
    const clientIp = client.remoteAddress ?? "unknown";
    this.logger.info({ event: "tcp_client_connected", client_ip: clientIp });

    try {
      while (this.running) {
        const rawQuery = await readDnsMessage(client, this.clientTimeoutSeconds);
        if (!rawQuery || rawQuery.length === 0) break;
        const response = await this.processor.process(rawQuery, "tcp", clientIp);
        if (!response.length) break;
        const frame = Buffer.allocUnsafe(2 + response.length);
        frame.writeUInt16BE(response.length, 0);
        response.copy(frame, 2);
        await writeAll(client, frame, this.clientTimeoutSeconds);
      }
    } catch (e) {
      this.logger.debug({
        event: "tcp_client_closed",
        client_ip: clientIp,
        error_class: e instanceof Error ? e.constructor.name : "Error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      client.destroy();
    }
  }
}
