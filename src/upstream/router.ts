import type { RecordMap } from "../config.js";
import type { JsonLogger } from "../json-logger.js";
import type { Metrics } from "../metrics.js";
import { DoTPool } from "./dot-pool.js";

function rotatePools<T>(pools: T[], start: number): T[] {
  const n = pools.length;
  if (n === 0) return pools;
  const s = start % n;
  return pools.slice(s).concat(pools.slice(0, s));
}

export class UpstreamRouter {
  private readonly pools: DoTPool[];
  private readonly logger: JsonLogger;
  private rrIndex = 0;
  private gate = Promise.resolve();

  constructor(upstreams: RecordMap[], logger: JsonLogger, metrics: Metrics) {
    this.pools = upstreams.map((u) => new DoTPool(u, logger, metrics));
    this.logger = logger;
  }

  async query(raw: Buffer): Promise<Buffer> {
    const ordered = await this.orderedPools();
    for (const pool of ordered) {
      if (!pool.available()) continue;
      try {
        return await pool.query(raw);
      } catch (e) {
        this.logger.warn({
          event: "upstream_failover",
          upstream: pool.name,
          error_class: e instanceof Error ? e.constructor.name : "Error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    throw new Error("all upstreams unavailable");
  }

  private async orderedPools(): Promise<DoTPool[]> {
    if (this.pools.length === 0) return [];
    const p = this.gate.then((): { pools: DoTPool[] } => {
      const start = this.rrIndex % this.pools.length;
      this.rrIndex += 1;
      return { pools: rotatePools(this.pools, start) };
    });
    this.gate = p.then(
      () => undefined,
      () => undefined,
    );
    const { pools } = await p;
    return pools;
  }
}
