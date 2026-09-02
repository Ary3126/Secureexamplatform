const db = require('../config/db');

/**
 * System Incidents Model (Phase 5.9.10)
 * 
 * Manages persistent storage of platform incidents, high-severity errors,
 * database connectivity faults, and execution environment degradations.
 */
class IncidentModel {
  /**
   * Log a new system incident
   */
  static async createIncident({
    category,
    severity = 'MEDIUM',
    endpoint = null,
    requestId = null,
    message,
    details = {},
    status = 'OPEN',
  }) {
    const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const safeSeverity = validSeverities.includes(severity) ? severity : 'MEDIUM';

    const safeDetails = typeof details === 'object' && details !== null ? details : {};

    const query = `
      INSERT INTO system_incidents (
        category,
        severity,
        endpoint,
        request_id,
        message,
        details,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, category, severity, endpoint, request_id, message, details, status, created_at, resolved_at;
    `;

    const values = [
      category || 'INTERNAL_ERROR',
      safeSeverity,
      endpoint ? String(endpoint).slice(0, 255) : null,
      requestId ? String(requestId).slice(0, 64) : null,
      message ? String(message).slice(0, 2000) : 'System encountered an incident',
      JSON.stringify(safeDetails),
      status || 'OPEN',
    ];

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Query incidents with pagination and filtering (Super Admin Only)
   */
  static async findIncidents({
    category,
    severity,
    status,
    search,
    page = 1,
    limit = 20,
  } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (category) {
      conditions.push(`category = $${idx++}`);
      values.push(category);
    }

    if (severity) {
      conditions.push(`severity = $${idx++}`);
      values.push(severity);
    }

    if (status) {
      conditions.push(`status = $${idx++}`);
      values.push(status);
    }

    if (search && search.trim()) {
      conditions.push(`(message ILIKE $${idx} OR endpoint ILIKE $${idx} OR request_id ILIKE $${idx})`);
      values.push(`%${search.trim()}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*)::int AS total FROM system_incidents ${whereClause}`;
    const countRes = await db.query(countQuery, values);
    const total = countRes.rows[0]?.total || 0;

    const dataQuery = `
      SELECT id, category, severity, endpoint, request_id, message, details, status, created_at, resolved_at
      FROM system_incidents
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++};
    `;

    const dataValues = [...values, limitNum, offset];
    const dataRes = await db.query(dataQuery, dataValues);

    return {
      incidents: dataRes.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  /**
   * Find single incident by ID
   */
  static async findById(id) {
    const query = `
      SELECT id, category, severity, endpoint, request_id, message, details, status, created_at, resolved_at
      FROM system_incidents
      WHERE id = $1;
    `;
    const res = await db.query(query, [id]);
    return res.rows[0] || null;
  }

  /**
   * Update incident status (e.g. OPEN -> INVESTIGATING -> RESOLVED)
   */
  static async updateStatus(id, newStatus) {
    const validStatuses = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Must be one of ${validStatuses.join(', ')}`);
    }

    const resolvedAt = newStatus === 'RESOLVED' || newStatus === 'DISMISSED' ? 'NOW()' : 'NULL';

    const query = `
      UPDATE system_incidents
      SET status = $1,
          resolved_at = ${resolvedAt}
      WHERE id = $2
      RETURNING id, category, severity, endpoint, request_id, message, details, status, created_at, resolved_at;
    `;

    const res = await db.query(query, [newStatus, id]);
    return res.rows[0] || null;
  }

  /**
   * Delete test-created incidents (for teardown hygiene)
   */
  static async purgeTestIncidents() {
    await db.query(`
      DELETE FROM system_incidents 
      WHERE message ILIKE '%[TEST]%' 
         OR category ILIKE '%TEST%' 
         OR endpoint ILIKE '%test%';
    `);
  }
}

module.exports = IncidentModel;
