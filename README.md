# DNServe — secure DNS forwarder (DoT)

UDP/TCP :53 → upstream DNS-over-TLS. Policy (block/allow), token-bucket rate limit, TTL cache, JSON logs, Prometheus `/metrics` and `/healthz` on :9100.

**Run:** `npm ci && npm run build && npm start -- -c config/default.yml`

**Docker:** `docker compose up --build`

**Test:** `npm test`

Port 53 needs elevated bind capability or a non-privileged port in config.
