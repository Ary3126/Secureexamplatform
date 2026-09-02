/**
 * AuditLog Model - Database Access Layer for Persistent Audit Logging
 * 
 * Provides append-only creation, indexed discovery, and super-admin querying.
 * Enforces parameterization, data normalization, bounded pagination, and user preservation.
 */

const db = require('../config/db');

class AuditLogModel {
  /**
   * Create an append-only audit log entry
   * @param {Object} logData
   * @param {number|null} [logData.actorId] - User ID who performed the action (nullable)
   * @param {string} logData.action - Normalized action identifier (e.g. 'PROBLEM_CREATED')
   * @param {string} [logData.resourceType='system'] - Resource type ('problem', 'contest', 'test_case', etc.)
   * @param {number|null} [logData.resourceId=null] - Resource ID if applicable
   * @param {string} [logData.outcome='success'] - 'success' | 'failure' | 'denied'
   * @param {Object} [logData.metadata={}] - Bounded, sanitized JSON metadata
   * @param {string|null} [logData.ipAddress=null] - Client IP address
   * @param {Object|null} [client=null] - Optional database client for transaction participation
   * @returns {Promise<Object>}
   */
  static async createAuditLog({
    actorId = null,
    action,
    resourceType = 'system',
    resourceId = null,
    outcome = 'success',
    metadata = {},
    ipAddress = null,
  }, client = null) {
    const normalizedOutcome = String(outcome || 'success').toLowerCase();
    const validOutcomes = ['success', 'failure', 'denied'];
    const safeOutcome = validOutcomes.includes(normalizedOutcome) ? normalizedOutcome : 'failure';

    const normalizedActorId = actorId && Number.isInteger(Number(actorId)) ? Number(actorId) : null;
    const normalizedResourceId = resourceId && Number.isInteger(Number(resourceId)) ? Number(resourceId) : null;
    const safeMetadata = metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : '{}';

    const text = `
      INSERT INTO audit_logs (
        actor_id,
        action,
        resource_type,
        resource_id,
        outcome,
        metadata,
        ip_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        id,
        actor_id AS "actorId",
        action,
        resource_type AS "resourceType",
        resource_id AS "resourceId",
        outcome,
        metadata,
        ip_address AS "ipAddress",
        created_at AS "createdAt";
    `;

    const values = [
      normalizedActorId,
      action,
      resourceType,
      normalizedResourceId,
      safeOutcome,
      safeMetadata,
      ipAddress || null,
    ];

    const executor = client || db;
    const res = await executor.query(text, values);
    return res.rows[0];
  }

  /**
   * Find paginated audit logs with dynamic filtering
   * @param {Object} filters
   * @param {number|string} [filters.actorId]
   * @param {string} [filters.action]
   * @param {string} [filters.resourceType]
   * @param {number|string} [filters.resourceId]
   * @param {string} [filters.outcome]
   * @param {string|Date} [filters.from] - Minimum created_at timestamp
   * @param {string|Date} [filters.to] - Maximum created_at timestamp
   * @param {number} [filters.page=1]
   * @param {number} [filters.limit=20] - Maximum 100
   * @returns {Promise<{ logs: Array, pagination: Object }>}
   */
  static async findAllAuditLogs({
    actorId,
    action,
    resourceType,
    resourceId,
    outcome,
    from,
    to,
    page = 1,
    limit = 20,
  } = {}) {
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const values = [];

    if (actorId !== undefined && actorId !== null && actorId !== '') {
      const parsedActorId = parseInt(actorId, 10);
      if (!Number.isNaN(parsedActorId)) {
        values.push(parsedActorId);
        conditions.push(`a.actor_id = $${values.length}`);
      }
    }

    if (action && typeof action === 'string' && action.trim()) {
      values.push(action.trim());
      conditions.push(`a.action = $${values.length}`);
    }

    if (resourceType && typeof resourceType === 'string' && resourceType.trim()) {
      values.push(resourceType.trim().toLowerCase());
      conditions.push(`LOWER(a.resource_type) = $${values.length}`);
    }

    if (resourceId !== undefined && resourceId !== null && resourceId !== '') {
      const parsedResId = parseInt(resourceId, 10);
      if (!Number.isNaN(parsedResId)) {
        values.push(parsedResId);
        conditions.push(`a.resource_id = $${values.length}`);
      }
    }

    if (outcome && typeof outcome === 'string' && outcome.trim()) {
      const normalizedOutcome = outcome.trim().toLowerCase();
      if (['success', 'failure', 'denied'].includes(normalizedOutcome)) {
        values.push(normalizedOutcome);
        conditions.push(`a.outcome = $${values.length}`);
      }
    }

    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        values.push(fromDate.toISOString());
        conditions.push(`a.created_at >= $${values.length}`);
      }
    }

    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        values.push(toDate.toISOString());
        conditions.push(`a.created_at <= $${values.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matches
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM audit_logs a
      ${whereClause};
    `;
    const countRes = await db.query(countQuery, values);
    const total = countRes.rows[0]?.total || 0;

    // Fetch paginated records with actor context
    values.push(limitNum);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const dataQuery = `
      SELECT 
        a.id,
        a.actor_id AS "actorId",
        u.username AS "actorUsername",
        u.role AS "actorRole",
        u.email AS "actorEmail",
        a.action,
        a.resource_type AS "resourceType",
        a.resource_id AS "resourceId",
        a.outcome,
        a.metadata,
        a.ip_address AS "ipAddress",
        a.created_at AS "createdAt"
      FROM audit_logs a
      LEFT JOIN users u ON a.actor_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const dataRes = await db.query(dataQuery, values);
    const logs = dataRes.rows;

    const totalPages = Math.ceil(total / limitNum) || 1;

    return {
      logs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    };
  }

  /**
   * Find single audit log by ID
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  static async findAuditLogById(id) {
    const text = `
      SELECT 
        a.id,
        a.actor_id AS "actorId",
        u.username AS "actorUsername",
        u.role AS "actorRole",
        u.email AS "actorEmail",
        a.action,
        a.resource_type AS "resourceType",
        a.resource_id AS "resourceId",
        a.outcome,
        a.metadata,
        a.ip_address AS "ipAddress",
        a.created_at AS "createdAt"
      FROM audit_logs a
      LEFT JOIN users u ON a.actor_id = u.id
      WHERE a.id = $1;
    `;
    const res = await db.query(text, [id]);
    return res.rows[0] || null;
  }
}

module.exports = AuditLogModel;
