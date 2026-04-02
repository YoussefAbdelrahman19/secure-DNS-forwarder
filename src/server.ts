import { AppConfig } from "./config.js";
import { Blocklist } from "./blocklist.js";
import { Cache } from "./cache.js";
import { JsonLogger } from "./json-logger.js";
import { Metrics } from "./metrics.js";
import { MetricsServer } from "./metrics-server.js";
import { QueryProcessor } from "./query-processor.js";
import { RateLimiter } from "./rate-limiter.js";
import { UdpServer } from "./udp-server.js";
import { TcpServer } from "./tcp-server.js";
import { UpstreamRouter } from "./upstream/router.js";

function num(m: Record<string, unknown>, key: string): number {
  return Number(m[key]);
}

function bool(m: Record<string, unknown>, key: string): boolean {
  return Boolean(m[key]);
}

function str(m: Record<string, unknown>, key: string, fallback: string): string {
  const v = m[key];
  return v == null ? fallback : String(v);
}

export class AppServer {
  private readonly logger: JsonLogger;
  private readonly metrics: Metrics;
  private readonly metricsServer: MetricsServer;
  private readonly udpServer: UdpServer;
  private readonly tcpServer: TcpServer;
  private shuttingDown = false;

  constructor(config: AppConfig) {
    const logCfg = config.logging;
    this.logger = new JsonLogger({
      level: str(logCfg, "level", "info"),
      json: bool(logCfg, "json"),
    });
    this.metrics = new Metrics();

    const cacheCfg = config.cache;
    const cache = new Cache({
      enabled: bool(cacheCfg, "enabled"),
      maxEntries: num(cacheCfg, "max_entries"),
      minTtlSeconds: num(cacheCfg, "min_ttl_seconds"),
      maxTtlSeconds: num(cacheCfg, "max_ttl_seconds"),
      negativeTtlSeconds: num(cacheCfg, "negative_ttl_seconds"),
    });

    const policyCfg = config.policy;
    const blocklist = new Blocklist(
      config.resolvePath(str(policyCfg, "blocklist_path", "")),
      config.resolvePath(str(policyCfg, "allowlist_path", "")),
    );

    const rl = policyCfg.rate_limit as Record<string, unknown>;
    const rateLimiter = new RateLimiter({
      enabled: bool(rl, "enabled"),
      requestsPerSecondPerClient: num(rl, "requests_per_second_per_client"),
      burst: num(rl, "burst"),
    });

    const router = new UpstreamRouter(config.upstreams, this.logger, this.metrics);

    const processor = new QueryProcessor(
      cache,
      blocklist,
      rateLimiter,
      router,
      this.logger,
      this.metrics,
      policyCfg as Record<string, unknown>,
    );

    const srv = config.server as Record<string, unknown>;
    this.udpServer = new UdpServer(
      str(srv, "bind_address", "0.0.0.0"),
      num(srv, "port"),
      num(srv, "udp_workers"),
      processor,
      this.logger,
      num(srv, "max_udp_packet_size"),
    );

    this.tcpServer = new TcpServer(
      str(srv, "bind_address", "0.0.0.0"),
      num(srv, "port"),
      num(srv, "tcp_backlog"),
      num(srv, "tcp_client_timeout_seconds"),
      processor,
      this.logger,
    );

    const met = config.metrics as Record<string, unknown>;
    this.metricsServer = new MetricsServer(
      bool(met, "enabled"),
      str(met, "bind_address", "127.0.0.1"),
      num(met, "port"),
      this.metrics,
      this.logger,
    );
  }

  start(): void {
    this.trapSignals();
    this.logger.info({ event: "dnsserve_starting" });
    this.metricsServer.start();
    this.udpServer.start();
    this.tcpServer.start();
  }

  stop(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info({ event: "dnsserve_stopping" });
    this.tcpServer.stop();
    this.udpServer.stop();
    this.metricsServer.stop();
  }

  private trapSignals(): void {
    const onStop = (): void => {
      this.stop();
      process.exit(0);
    };
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
  }
}
