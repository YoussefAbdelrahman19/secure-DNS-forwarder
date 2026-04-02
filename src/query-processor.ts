import { Message, ParseError } from "./dns/message.js";
import type { Cache } from "./cache.js";
import type { Blocklist } from "./blocklist.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { JsonLogger } from "./json-logger.js";
import type { Metrics } from "./metrics.js";
import type { RecordMap } from "./config.js";
import type { UpstreamRouter } from "./upstream/router.js";

const RCODE_MAP: Record<string, number> = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  NOTIMP: 4,
  REFUSED: 5,
};

export class QueryProcessor {
  private readonly inflight = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly cache: Cache,
    private readonly blocklist: Blocklist,
    private readonly rateLimiter: RateLimiter,
    private readonly router: UpstreamRouter,
    private readonly logger: JsonLogger,
    private readonly metrics: Metrics,
    private readonly policyConfig: RecordMap,
  ) {}

  async process(rawQuery: Buffer, protocol: "udp" | "tcp", clientIp: string): Promise<Buffer> {
    const started = performance.now() / 1000;
    this.metrics.increment("dnsserve_queries_total", { protocol });

    try {
      const query = Message.parse(rawQuery);
      const qname = (query.qname ?? "").toLowerCase();
      const qtype = query.qtype ?? 0;

      if (!this.rateLimiter.allow(clientIp)) {
        this.metrics.increment("dnsserve_policy_drops_total", { reason: "rate_limit" });
        this.logger.warn({
          event: "query_rate_limited",
          client_ip: clientIp,
          protocol,
          qname,
          qtype,
        });
        return Message.buildErrorResponse(query, 5);
      }

      if (qname.length === 0 || query.qdcount !== 1 || query.qr()) {
        this.metrics.increment("dnsserve_invalid_queries_total");
        return Message.buildErrorResponse(query, 1);
      }

      if (this.blocklist.blocked(qname)) {
        this.metrics.increment("dnsserve_policy_drops_total", { reason: "blocklist" });
        this.logger.info({
          event: "query_blocked",
          client_ip: clientIp,
          protocol,
          qname,
          qtype,
        });
        const code = String(this.policyConfig.block_response_code ?? "REFUSED");
        const rcode = RCODE_MAP[code] ?? 5;
        return Message.buildErrorResponse(query, rcode);
      }

      const cached = this.cache.fetch(query);
      if (cached) {
        this.metrics.increment("dnsserve_cache_hits_total");
        this.metrics.observe("dnsserve_query_latency_seconds", performance.now() / 1000 - started, {
          protocol,
          result: "cache_hit",
        });
        return cached;
      }

      this.metrics.increment("dnsserve_cache_misses_total");
      const key = query.cacheKey();
      const upstreamRaw = await this.resolveUpstream(key, query, rawQuery);
      const response = Message.parse(upstreamRaw);
      if (response.rcode() === 0 || response.rcode() === 3) {
        this.cache.write(query, response);
      }

      this.metrics.observe("dnsserve_query_latency_seconds", performance.now() / 1000 - started, {
        protocol,
        result: "upstream",
      });

      this.logger.info({
        event: "query_processed",
        client_ip: clientIp,
        protocol,
        qname,
        qtype,
        rcode: response.rcode(),
      });

      return upstreamRaw;
    } catch (e) {
      if (e instanceof ParseError) {
        this.metrics.increment("dnsserve_invalid_queries_total");
        this.logger.warn({
          event: "query_parse_error",
          client_ip: clientIp,
          protocol,
          error_class: e.constructor.name,
          error: e.message,
        });
        try {
          const fallbackQuery = Message.parse(rawQuery);
          return Message.buildErrorResponse(fallbackQuery, 1);
        } catch {
          return Buffer.alloc(0);
        }
      }

      this.metrics.increment("dnsserve_processing_failures_total");
      this.logger.error({
        event: "query_processing_failed",
        client_ip: clientIp,
        protocol,
        error_class: e instanceof Error ? e.constructor.name : "Error",
        error: e instanceof Error ? e.message : String(e),
      });
      try {
        const fallbackQuery = Message.parse(rawQuery);
        return Message.buildErrorResponse(fallbackQuery, 2);
      } catch {
        return Buffer.alloc(0);
      }
    }
  }

  private async resolveUpstream(key: string, query: Message, rawQuery: Buffer): Promise<Buffer> {
    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        try {
          return await this.router.query(rawQuery);
        } finally {
          this.inflight.delete(key);
        }
      })();
      this.inflight.set(key, p);
    }
    return p;
  }
}
