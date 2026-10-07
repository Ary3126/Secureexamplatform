/**
 * Privileged Action Audit Logger (Persistent PostgreSQL Security Logging)
 * 
 * Securely logs administrative, privileged, and sensitive state-changing operations
 * into PostgreSQL with recursive metadata sanitization, transaction support,
 * bounded payload safety, and anti-spoofing IP extraction.
 */

const config = require('../config/env');
const AuditLogModel = require('../models/auditLogModel');

// Denied sensitive keys that must never be stored in audit metadata
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /^pass(word)?_?hash/i,
  /^jwt$/i,
  /^token$/i,
  /^.*_?token$/i,
  /^access_?token/i,
  /^refresh_?token/i,
  /^bearer_?token/i,
  /^secret/i,
  /^.*_?secret$/i,
  /^auth(orization)?$/i,
  /^cookie$/i,
  /^set[-_]?cookie$/i,
  /^session(_?id)?/i,
  /^api_?key/i,
  /^.*_?api_?key/i,
  /^private_?key/i,
  /^.*_?private_?key/i,
  /^credentials?$/i,
  /^source_?code$/i,
  /^code$/i,
  /^.*_?code$/i,
  /^input_?data$/i,
  /^expected_?output$/i,
  /^hidden_?tests?$/i,
  /^hidden_?test_?cases?$/i,
];

/**
 * Safely extract client IP address respecting trusted proxy configuration
 * @param {import('express').Request} req
 * @returns {string}
 */
function getSafeClientIp(req) {
  if (!req) return '127.0.0.1';
  const trustProxy = process.env.TRUST_PROXY === 'true' || (req.app && req.app.get && req.app.get('trust proxy'));

  if (trustProxy && req.headers && req.headers['x-forwarded-for']) {
    const forwarded = String(req.headers['x-forwarded-for']).split(',')[0].trim();
    if (forwarded) return forwarded;
  }

  return req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
}

/**
 * Recursively sanitize metadata to remove sensitive tokens, passwords, and source code
 * @param {*} data - Value to sanitize
 * @param {number} [depth=0] - Recursion depth limit
 * @returns {*}
 */
function sanitizeMetadata(data, depth = 0) {
  if (depth > 8 || data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (typeof data === 'object') {
    const cleanObj = {};
    for (const [key, value] of Object.entries(data)) {
      // Prototype pollution defense
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }

      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        continue; // Strictly omit sensitive keys
      }

      if (typeof value === 'string') {
        // Redact strings that look like JWT tokens (with optional Bearer prefix)
        if (/^(Bearer\s+)?eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/i.test(value)) {
          continue;
        }
        // Bound string length in metadata
        cleanObj[key] = value.length > 500 ? value.substring(0, 500) + '...[truncated]' : value;
      } else if (typeof value === 'object' && value !== null) {
        cleanObj[key] = sanitizeMetadata(value, depth + 1);
      } else {
        cleanObj[key] = value;
      }
    }
    return cleanObj;
  }

  return data;
}

class AuditLogger {
  /**
   * Log a privileged, administrative, or sensitive state-changing action to PostgreSQL
   * 
   * @param {Object} options
   * @param {Object} [options.actor] - User object ({ id, username, role })
   * @param {number|null} [options.actorId] - Explicit user ID
   * @param {string} options.action - Normalized action identifier (e.g. 'PROBLEM_CREATED', 'CONTEST_PUBLISHED')
   * @param {string} [options.resourceType='system'] - Target resource type ('contest', 'problem', 'test_case', 'snapshot', 'user')
   * @param {string|number|null} [options.resourceId=null] - Target resource ID
   * @param {string} [options.outcome='success'] - 'success' | 'failure' | 'denied' (case-insensitive)
   * @param {Object} [options.metadata={}] - Additional context metadata (will be sanitized)
   * @param {string|null} [options.ipAddress=null] - Client IP address
   * @param {import('express').Request|null} [options.req=null] - Express request object for automatic IP/user extraction
   * @param {Object|null} [options.client=null] - Optional database client for transaction participation
   * @returns {Promise<Object>} The persisted audit record (with synchronous property access support)
   */
  static logAction({
    actor = null,
    actorId = null,
    action,
    resourceType = 'system',
    resourceId = null,
    outcome = 'success',
    metadata = {},
    ipAddress = null,
    req = null,
    client = null,
  }) {
    // 1. Resolve Actor ID
    let resolvedActorId = actorId;
    if (resolvedActorId === null || resolvedActorId === undefined) {
      if (actor && actor.id) {
        resolvedActorId = actor.id;
      } else if (req && req.user && req.user.id) {
        resolvedActorId = req.user.id;
      }
    }
    const safeActorId = resolvedActorId && Number.isInteger(Number(resolvedActorId)) ? Number(resolvedActorId) : null;

    // 2. Resolve Client IP Address
    const safeIp = ipAddress || (req ? getSafeClientIp(req) : null);

    // 3. Normalize Outcome
    const rawOutcome = String(outcome || 'success').toLowerCase();
    let normalizedOutcome = 'success';
    if (rawOutcome === 'denied' || rawOutcome === 'forbidden') {
      normalizedOutcome = 'denied';
    } else if (rawOutcome === 'failed' || rawOutcome === 'failure' || rawOutcome === 'error') {
      normalizedOutcome = 'failure';
    }

    // 4. Sanitize Metadata
    const safeMetadata = sanitizeMetadata(metadata);

    // 5. Normalize Resource ID
    const safeResourceId = resourceId && Number.isInteger(Number(resourceId)) ? Number(resourceId) : null;

    // 6. Base in-memory audit record for synchronous consumption
    const auditEntry = {
      id: null,
      actorId: safeActorId,
      action,
      resourceType,
      resourceId: safeResourceId,
      outcome: normalizedOutcome,
      metadata: safeMetadata,
      ipAddress: safeIp,
      createdAt: new Date().toISOString(),
      actor: {
        id: safeActorId,
        username: actor ? actor.username : 'user',
        role: actor ? actor.role : 'none',
      },
      resource: {
        type: resourceType,
        id: safeResourceId,
      },
    };

    // 7. Console output for structured cloud observability (disabled in test runs)
    if (config.nodeEnv !== 'test') {
      const actorTag = actor ? `${actor.username} (${actor.role}#${safeActorId})` : `User#${safeActorId || 'ANONYMOUS'}`;
      console.log(`[SECURITY AUDIT] [${auditEntry.createdAt}] [${action}] [${normalizedOutcome.toUpperCase()}] Actor:${actorTag} Target:${resourceType}#${safeResourceId}`, safeMetadata);
    }

    // 8. Asynchronous persistence to PostgreSQL
    const persistencePromise = (async () => {
      try {
        const persisted = await AuditLogModel.createAuditLog({
          actorId: safeActorId,
          action,
          resourceType,
          resourceId: safeResourceId,
          outcome: normalizedOutcome,
          metadata: safeMetadata,
          ipAddress: safeIp,
        }, client);

        if (persisted) {
          auditEntry.id = persisted.id;
          auditEntry.createdAt = persisted.createdAt;
        }
        return auditEntry;
      } catch (dbErr) {
        console.error('[AUDIT LOGGER DB ERROR] Failed to persist audit log to PostgreSQL:', dbErr.message);
        if (client) {
          throw dbErr;
        }
        return auditEntry;
      }
    })();

    // Expose synchronous properties on the promise itself
    Object.assign(persistencePromise, auditEntry);

    return persistencePromise;
  }

  /**
   * Helper to expose metadata sanitizer for unit tests and validators
   */
  static sanitize(data) {
    return sanitizeMetadata(data);
  }
}

module.exports = AuditLogger;
