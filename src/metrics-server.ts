import http from "node:http";
import type { JsonLogger } from "./json-logger.js";
import type { Metrics } from "./metrics.js";

export class MetricsServer {
  private server: http.Server | null = null;

  constructor(
    private readonly enabled: boolean,
    private readonly bindAddress: string,
    private readonly port: number,
    private readonly metrics: Metrics,
    private readonly logger: JsonLogger,
  ) {}

  start(): void {
    if (!this.enabled) return;

    this.server = http.createServer((req, res) => {
      if (req.url === "/metrics") {
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(this.metrics.renderPrometheus());
        return;
      }
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok\n");
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.server.listen(this.port, this.bindAddress, () => {
      this.logger.info({
        event: "metrics_server_started",
        bind_address: this.bindAddress,
        port: this.port,
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}
