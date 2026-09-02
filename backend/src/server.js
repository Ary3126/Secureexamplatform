const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config/env');
const { closePool } = require('./config/db');
const { initDb } = require('./config/initDb');
const { corsOptions } = require('./config/corsConfig');
const { timeoutMiddleware } = require('./middleware/timeoutMiddleware');
const { requestIdMiddleware } = require('./middleware/requestIdMiddleware');
const { metricsMiddleware } = require('./middleware/metricsMiddleware');
const { publicReadRateLimiter } = require('./middleware/rateLimitMiddleware');
const RATE_LIMIT_CONFIG = require('./config/rateLimitConfig');
const apiRoutes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
} else {
  app.set('trust proxy', false);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'http://localhost:*', 'ws://localhost:*', 'http://127.0.0.1:*', 'ws://127.0.0.1:*', 'https:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts:
      config.nodeEnv === 'production' && process.env.ENABLE_HSTS === 'true'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
  })
);

app.use(cors(corsOptions));
app.use(requestIdMiddleware);
app.use(metricsMiddleware);
app.use(timeoutMiddleware);
app.use(express.json({ limit: RATE_LIMIT_CONFIG.LIMITS.maxJsonBodyBytes }));
app.use(express.urlencoded({ extended: true, limit: RATE_LIMIT_CONFIG.LIMITS.maxUrlEncodedBytes }));

app.use('/api', apiRoutes);

app.get('/health', publicReadRateLimiter, (req, res) => {
  res.redirect('/api/health');
});

app.get('/', publicReadRateLimiter, (req, res) => {
  res.status(200).json({
    name: 'Secure Competitive Programming & Examination Platform API',
    version: '5.0.0',
    status: 'Running',
    security: {
      rateLimiting: 'Active',
      corsHardening: 'Active',
      securityHeaders: 'Active',
      bodyLimit: RATE_LIMIT_CONFIG.LIMITS.maxJsonBodyBytes,
      timeoutMs: RATE_LIMIT_CONFIG.LIMITS.apiTimeoutMs,
    },
    endpoints: {
      healthCheck: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      contests: '/api/contests',
      problems: '/api/problems',
      submissions: '/api/submissions',
      leaderboard: '/api/leaderboard',
    },
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

let server;

const listenOnAvailablePort = (initialPort, maxAttempts = 10) => {
  return new Promise((resolve, reject) => {
    let currentPort = initialPort;
    let attempts = 0;

    const tryListen = () => {
      const srv = app.listen(currentPort);

      srv.on('listening', () => {
        server = srv;
        if (currentPort !== initialPort) {
          console.warn('[PORT NOTICE] Primary port ' + initialPort + ' was occupied. Automatically switched to fallback port: ' + currentPort);
        }
        console.log('=======================================================');
        console.log(' Secure Exam Platform Backend Server Started (Phase 5) ');
        console.log(' Environment: ' + config.nodeEnv);
        console.log(' Listening on: http://localhost:' + currentPort);
        console.log(' Health check: http://localhost:' + currentPort + '/api/health');
        console.log('=======================================================');
        resolve(srv);
      });

      srv.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          attempts++;
          if (attempts < maxAttempts) {
            console.warn('[PORT WARNING] Port ' + currentPort + ' in use. Attempting fallback port ' + (currentPort + 1) + '...');
            currentPort++;
            tryListen();
          } else {
            console.error('\n[PORT ERROR] Could not find an open port after ' + maxAttempts + ' attempts starting from ' + initialPort + '.');
            reject(err);
          }
        } else {
          reject(err);
        }
      });
    };

    tryListen();
  });
};

const startServer = async () => {
  try {
    await initDb();
  } catch (err) {
    console.warn('[DATABASE WARNING] Could not auto-initialize tables on startup:', err.message);
  }

  const initialPort = parseInt(process.env.PORT, 10) || parseInt(config.port, 10) || 5000;
  return await listenOnAvailablePort(initialPort);
};

const handleShutdown = async (signal) => {
  console.log('\n[SHUTDOWN] Received ' + signal + '. Gracefully shutting down...');
  if (server) {
    server.close(async () => {
      console.log('[SHUTDOWN] HTTP server closed.');
      await closePool();
      process.exit(0);
    });
  } else {
    await closePool();
    process.exit(0);
  }

  setTimeout(() => {
    console.error('[SHUTDOWN] Forceful shutdown triggered due to timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, handleShutdown };
