interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly enabled: boolean;
  private readonly rate: number;
  private readonly burst: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(params: {
    enabled: boolean;
    requestsPerSecondPerClient: number;
    burst: number;
  }) {
    this.enabled = params.enabled;
    this.rate = params.requestsPerSecondPerClient;
    this.burst = params.burst;
  }

  allow(clientIp: string): boolean {
    if (!this.enabled) return true;
    const now = performance.now() / 1000;
    const key = String(clientIp);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.burst, updatedAt: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = now - bucket.updatedAt;
    bucket.updatedAt = now;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.rate);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
}
