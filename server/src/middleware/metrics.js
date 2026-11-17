import { safeEqual } from '../utils/crypto.js';

const BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * Route pattern for a finished request. Express resets `baseUrl` once the router exits, so the
 * mount prefix is rebuilt from the leading URL segments, and the matched route's own pattern
 * replaces the trailing ones (e.g. /api/v1/investments + /:slug). Unmatched requests share one label.
 */
function routeLabel(req) {
  const pattern = req.route?.path;
  if (typeof pattern !== 'string') return 'unmatched';
  const segments = req.originalUrl.split('?')[0].split('/').filter(Boolean);
  const own = pattern.split('/').filter(Boolean).length;
  const prefix = segments.slice(0, Math.max(0, segments.length - own)).join('/');
  return `/${prefix}${pattern === '/' ? '/' : pattern}`.replace(/\/{2,}/g, '/');
}

/**
 * In-process HTTP metrics in the Prometheus text format, with no dependency.
 * Labels use the matched route pattern (e.g. /api/v1/statements/:id/download-url), never the raw
 * URL, so IDs and query strings never become label values. Counters are per process: scrape
 * every instance (or put a Prometheus agent alongside each one).
 */
export function createMetrics() {
  const requests = new Map(); // `${method} ${route} ${statusClass}` -> count
  const latency = new Map(); // `${method} ${route}` -> { buckets: number[], sum, count }
  const startedAt = Date.now();

  const record = (method, route, status, ms) => {
    const cls = `${Math.floor(status / 100)}xx`;
    const rk = `${method}\u0000${route}\u0000${cls}`;
    requests.set(rk, (requests.get(rk) ?? 0) + 1);
    const lk = `${method}\u0000${route}`;
    const h = latency.get(lk) ?? { buckets: BUCKETS_MS.map(() => 0), sum: 0, count: 0 };
    BUCKETS_MS.forEach((b, i) => {
      if (ms <= b) h.buckets[i] += 1;
    });
    h.sum += ms;
    h.count += 1;
    latency.set(lk, h);
  };

  return {
    middleware() {
      return (req, res, next) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          const route = routeLabel(req);
          record(req.method, route, res.statusCode, ms);
        });
        next();
      };
    },

    render() {
      const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const lines = ['# HELP mynx_http_requests_total HTTP requests by route and status class.', '# TYPE mynx_http_requests_total counter'];
      for (const [k, v] of requests) {
        const [method, route, cls] = k.split('\u0000');
        lines.push(`mynx_http_requests_total{method="${method}",route="${esc(route)}",status="${cls}"} ${v}`);
      }
      lines.push(
        '# HELP mynx_http_request_duration_ms HTTP request latency in milliseconds.',
        '# TYPE mynx_http_request_duration_ms histogram',
      );
      for (const [k, h] of latency) {
        const [method, route] = k.split('\u0000');
        const labels = `method="${method}",route="${esc(route)}"`;
        BUCKETS_MS.forEach((b, i) => lines.push(`mynx_http_request_duration_ms_bucket{${labels},le="${b}"} ${h.buckets[i]}`));
        lines.push(`mynx_http_request_duration_ms_bucket{${labels},le="+Inf"} ${h.count}`);
        lines.push(`mynx_http_request_duration_ms_sum{${labels}} ${h.sum.toFixed(1)}`);
        lines.push(`mynx_http_request_duration_ms_count{${labels}} ${h.count}`);
      }
      const mem = process.memoryUsage();
      lines.push(
        '# HELP mynx_process_resident_memory_bytes Resident memory.',
        '# TYPE mynx_process_resident_memory_bytes gauge',
        `mynx_process_resident_memory_bytes ${mem.rss}`,
        '# HELP mynx_process_heap_used_bytes V8 heap in use.',
        '# TYPE mynx_process_heap_used_bytes gauge',
        `mynx_process_heap_used_bytes ${mem.heapUsed}`,
        '# HELP mynx_process_uptime_seconds Seconds since the process started.',
        '# TYPE mynx_process_uptime_seconds gauge',
        `mynx_process_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
      );
      return `${lines.join('\n')}\n`;
    },

    /** GET handler. Requires `Authorization: Bearer <METRICS_TOKEN>`; disabled when no token is configured. */
    handler(token) {
      return (req, res) => {
        const given = (req.get('authorization') ?? '').replace(/^Bearer /, '');
        if (!token || !given || !safeEqual(given, token)) return res.status(404).end();
        res.set({ 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' }).send(this.render());
      };
    },
  };
}
