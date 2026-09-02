const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('../config/db');

/**
 * Subsystem Health & Diagnostics Service (Phase 5.9.10)
 * 
 * Performs deep, non-leaking health audits across PostgreSQL connection pool,
 * judge compiler execution sandboxes, storage hygiene, and process resource utilization.
 */
class SystemHealthService {
  /**
   * Measure PostgreSQL database health, connection latency, and pool statistics
   */
  static async checkDatabaseHealth() {
    const start = process.hrtime.bigint();
    try {
      await db.query('SELECT 1;');
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100;

      const pool = db.getPool ? db.getPool() : null;
      const poolStats = pool
        ? {
            totalConnections: pool.totalCount || 0,
            idleConnections: pool.idleCount || 0,
            waitingRequests: pool.waitingCount || 0,
          }
        : { totalConnections: 1, idleConnections: 1, waitingRequests: 0 };

      const status = durationMs > 250 ? 'DEGRADED' : 'HEALTHY';

      return {
        status,
        latencyMs: durationMs,
        pool: poolStats,
        message: status === 'HEALTHY' ? 'Database responding normally' : 'Database responding with elevated latency',
      };
    } catch (err) {
      return {
        status: 'UNHEALTHY',
        latencyMs: null,
        pool: null,
        message: 'Database connection failed or query timed out',
      };
    }
  }

  /**
   * Check Judge compilers & execution sandbox readiness
   */
  static async checkJudgeHealth() {
    const compilers = {
      python: { available: false, version: null },
      cpp: { available: false, version: null },
      java: { available: false, version: null },
    };

    // Check Python
    try {
      const pyOut = execSync('python --version', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      compilers.python = { available: true, version: pyOut || 'Python 3' };
    } catch (e) {
      try {
        const py3Out = execSync('py -3 --version', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
        compilers.python = { available: true, version: py3Out || 'Python 3' };
      } catch (e2) {
        compilers.python = { available: false, version: null };
      }
    }

    // Check C++ (g++)
    try {
      const cppOut = execSync('g++ --version', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().split('\n')[0];
      compilers.cpp = { available: true, version: cppOut || 'g++' };
    } catch (e) {
      compilers.cpp = { available: false, version: null };
    }

    // Check Java (javac / java)
    try {
      const javacOut = execSync('javac -version', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      compilers.java = { available: true, version: javacOut || 'javac' };
    } catch (e) {
      compilers.java = { available: false, version: null };
    }

    const availableCount = Object.values(compilers).filter((c) => c.available).length;
    let status = 'HEALTHY';
    let message = 'All language compilers operational';

    if (availableCount === 0) {
      status = 'UNHEALTHY';
      message = 'No language compilers available on host';
    } else if (availableCount < 3) {
      status = 'DEGRADED';
      message = `${availableCount}/3 language compilers available`;
    }

    return {
      status,
      compilers,
      message,
    };
  }

  /**
   * Check temporary workspace filesystem writeability
   */
  static checkStorageHealth() {
    try {
      const tempBase = path.resolve(os.tmpdir(), 'secure_judge_health_check');
      fs.mkdirSync(tempBase, { recursive: true });
      const testFile = path.join(tempBase, `probe_${Date.now()}.tmp`);
      fs.writeFileSync(testFile, 'probe_ok');
      fs.unlinkSync(testFile);

      return {
        status: 'HEALTHY',
        tempDir: 'Operational',
        freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
        totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      };
    } catch (err) {
      return {
        status: 'DEGRADED',
        tempDir: 'Write permission fault',
        message: err.message,
      };
    }
  }

  /**
   * Aggregate overall system health
   */
  static async getFullHealthDiagnostics() {
    const [dbHealth, judgeHealth, storageHealth] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkJudgeHealth(),
      Promise.resolve(this.checkStorageHealth()),
    ]);

    const memUsage = process.memoryUsage();

    let overall = 'HEALTHY';
    if (dbHealth.status === 'UNHEALTHY' || judgeHealth.status === 'UNHEALTHY') {
      overall = 'UNHEALTHY';
    } else if (dbHealth.status === 'DEGRADED' || judgeHealth.status === 'DEGRADED' || storageHealth.status === 'DEGRADED') {
      overall = 'DEGRADED';
    }

    return {
      overall,
      backend: {
        status: 'HEALTHY',
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development',
        memory: {
          heapUsedMb: Math.round(memUsage.heapUsed / (1024 * 1024)),
          heapTotalMb: Math.round(memUsage.heapTotal / (1024 * 1024)),
          rssMb: Math.round(memUsage.rss / (1024 * 1024)),
        },
      },
      database: dbHealth,
      judge: judgeHealth,
      storage: storageHealth,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Fast readiness check for load balancers & container orchestrators
   */
  static async getReadiness() {
    const dbHealth = await this.checkDatabaseHealth();
    const isReady = dbHealth.status !== 'UNHEALTHY';

    return {
      isReady,
      status: isReady ? 'READY' : 'NOT_READY',
      database: dbHealth.status,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = SystemHealthService;
