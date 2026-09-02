/**
 * In-Memory & Bounded API Request Performance Metrics Service (Phase 5.9.10)
 * 
 * Tracks request counts, durations, status codes, and error categories in a 
 * bounded circular buffer to calculate real-time p50, p95, p99 latencies, error rates, 
 * and identify performance hotspots without unbounded memory growth or sensitive payload logging.
 */

const MAX_BUFFER_SIZE = 10000;

class MetricsService {
  constructor() {
    this.buffer = [];
    this.head = 0;
    this.isFull = false;
    this.totalRequestsServed = 0;
    this.totalErrorsServed = 0;
    this.startTime = Date.now();
  }

  /**
   * Normalize route endpoint to prevent high-cardinality aggregation explosion
   * e.g. /api/problems/2529 -> /api/problems/:id
   */
  normalizeEndpoint(urlPath) {
    if (!urlPath) return '/';
    const cleanPath = urlPath.split('?')[0];
    return cleanPath
      .replace(/\/\d+(\/|$)/g, '/:id$1')
      .replace(/\/[a-f0-9-]{36}(\/|$)/gi, '/:uuid$1')
      .replace(/\/$/, '') || '/';
  }

  /**
   * Record single completed API transaction
   */
  recordRequest({ endpoint, method, statusCode, durationMs, role, errorCategory }) {
    const normEndpoint = this.normalizeEndpoint(endpoint);
    const item = {
      endpoint: normEndpoint,
      method: (method || 'GET').toUpperCase(),
      statusCode: Number(statusCode) || 200,
      durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
      timestamp: Date.now(),
      role: role || 'anonymous',
      errorCategory: errorCategory || null,
    };

    this.totalRequestsServed++;
    if (item.statusCode >= 400) {
      this.totalErrorsServed++;
    }

    if (this.buffer.length < MAX_BUFFER_SIZE) {
      this.buffer.push(item);
    } else {
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % MAX_BUFFER_SIZE;
      this.isFull = true;
    }
  }

  /**
   * Calculate exact percentile from sorted numeric array
   */
  calculatePercentile(sortedValues, percentile) {
    if (!sortedValues || sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    const safeIndex = Math.max(0, Math.min(sortedValues.length - 1, index));
    return sortedValues[safeIndex];
  }

  /**
   * Compute comprehensive platform performance & latency metrics
   */
  getMetricsSummary(timeWindowMs = 3600000) {
    const now = Date.now();
    const cutoff = now - timeWindowMs;
    const recentItems = this.buffer.filter((item) => item.timestamp >= cutoff);

    const totalCount = recentItems.length;
    if (totalCount === 0) {
      return {
        windowMs: timeWindowMs,
        totalRequests: 0,
        lifetimeTotalRequests: this.totalRequestsServed,
        errorRatePct: 0,
        averageLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        statusCodeBreakdown: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
        errorCategoryBreakdown: {},
        hotspots: [],
        highestErrorRoutes: [],
        timestamp: new Date().toISOString(),
      };
    }

    const durations = recentItems.map((r) => r.durationMs).sort((a, b) => a - b);
    const sumDuration = durations.reduce((acc, v) => acc + v, 0);
    const avgDuration = Math.round((sumDuration / totalCount) * 100) / 100;

    const p50 = this.calculatePercentile(durations, 50);
    const p95 = this.calculatePercentile(durations, 95);
    const p99 = this.calculatePercentile(durations, 99);

    let count2xx = 0;
    let count3xx = 0;
    let count4xx = 0;
    let count5xx = 0;

    const statusCounts = {};
    const errorCatCounts = {};
    const routeStats = {};

    for (const item of recentItems) {
      // Status code categories
      if (item.statusCode >= 200 && item.statusCode < 300) count2xx++;
      else if (item.statusCode >= 300 && item.statusCode < 400) count3xx++;
      else if (item.statusCode >= 400 && item.statusCode < 500) count4xx++;
      else if (item.statusCode >= 500) count5xx++;

      statusCounts[item.statusCode] = (statusCounts[item.statusCode] || 0) + 1;

      // Error Category
      if (item.errorCategory) {
        errorCatCounts[item.errorCategory] = (errorCatCounts[item.errorCategory] || 0) + 1;
      }

      // Route Aggregations
      const routeKey = `${item.method} ${item.endpoint}`;
      if (!routeStats[routeKey]) {
        routeStats[routeKey] = {
          route: routeKey,
          method: item.method,
          endpoint: item.endpoint,
          count: 0,
          totalDuration: 0,
          durations: [],
          errors: 0,
        };
      }
      routeStats[routeKey].count++;
      routeStats[routeKey].totalDuration += item.durationMs;
      routeStats[routeKey].durations.push(item.durationMs);
      if (item.statusCode >= 400) {
        routeStats[routeKey].errors++;
      }
    }

    const totalErrors = count4xx + count5xx;
    const errorRatePct = Math.round((totalErrors / totalCount) * 10000) / 100;

    // Rank Route Hotspots (Slowest endpoints)
    const rankedRoutes = Object.values(routeStats).map((r) => {
      r.durations.sort((a, b) => a - b);
      const avg = Math.round((r.totalDuration / r.count) * 10) / 10;
      const p95Route = this.calculatePercentile(r.durations, 95);
      const errorRate = Math.round((r.errors / r.count) * 10000) / 100;
      return {
        route: r.route,
        method: r.method,
        endpoint: r.endpoint,
        requestCount: r.count,
        errorCount: r.errors,
        errorRatePct: errorRate,
        averageLatencyMs: avg,
        p95LatencyMs: p95Route,
      };
    });

    const hotspots = [...rankedRoutes]
      .sort((a, b) => b.averageLatencyMs - a.averageLatencyMs)
      .slice(0, 10);

    const highestErrorRoutes = [...rankedRoutes]
      .filter((r) => r.errorCount > 0)
      .sort((a, b) => b.errorRatePct - a.errorRatePct)
      .slice(0, 10);

    return {
      windowMs: timeWindowMs,
      totalRequests: totalCount,
      lifetimeTotalRequests: this.totalRequestsServed,
      totalErrors,
      errorRatePct,
      averageLatencyMs: avgDuration,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      statusCodeBreakdown: {
        '2xx': count2xx,
        '3xx': count3xx,
        '4xx': count4xx,
        '5xx': count5xx,
        details: statusCounts,
      },
      errorCategoryBreakdown: errorCatCounts,
      hotspots,
      highestErrorRoutes,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reset circular buffer (for testing and isolation)
   */
  clear() {
    this.buffer = [];
    this.head = 0;
    this.isFull = false;
    this.totalRequestsServed = 0;
    this.totalErrorsServed = 0;
    this.startTime = Date.now();
  }
}

// Global Singleton
const metricsService = new MetricsService();

module.exports = metricsService;
