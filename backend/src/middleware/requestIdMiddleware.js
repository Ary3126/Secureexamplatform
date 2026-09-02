const crypto = require('crypto');

/**
 * Request Correlation ID Middleware (Phase 5.9.10)
 * 
 * Extracts or generates a unique correlation request identifier for every incoming HTTP request.
 * Sets req.id and response header 'X-Request-ID' for end-to-end tracing and error debugging.
 */
const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

const requestIdMiddleware = (req, res, next) => {
  const incomingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];

  let requestId;
  if (typeof incomingId === 'string' && REQUEST_ID_REGEX.test(incomingId.trim())) {
    requestId = incomingId.trim();
  } else {
    // Generate secure UUID v4 or random hex if randomUUID is unavailable
    if (typeof crypto.randomUUID === 'function') {
      requestId = crypto.randomUUID();
    } else {
      requestId = 'req_' + crypto.randomBytes(16).toString('hex');
    }
  }

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};

module.exports = {
  requestIdMiddleware,
};
