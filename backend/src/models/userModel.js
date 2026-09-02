const db = require('../config/db');

/**
 * User Model - Encapsulates all parameterized SQL interactions for the users table
 */
class UserModel {
  /**
   * Create a new user record
   * @param {Object} userData - { username, email, passwordHash, fullName, role, bio, avatarUrl, institution }
   * @returns {Promise<Object>} Created user record
   */
  static async createUser({ username, email, passwordHash, fullName, role = 'student', bio = '', avatarUrl = '', institution = '' }) {
    const text = `
      INSERT INTO users (username, email, password_hash, full_name, role, bio, avatar_url, institution, current_rating, highest_rating, rating_status, rated_contest_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1200, 1200, 'provisional', 0)
      RETURNING 
        id, 
        username, 
        email, 
        full_name, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active, 
        is_active AS "isActive", 
        created_at, 
        created_at AS "createdAt", 
        updated_at, 
        updated_at AS "updatedAt";
    `;
    const values = [username.trim(), email.trim().toLowerCase(), passwordHash, fullName.trim(), role, bio || '', avatarUrl || '', institution ? institution.trim() : ''];
    const res = await db.query(text, values);
    return res.rows[0];
  }

  /**
   * Find a user by email (case-insensitive)
   * @param {string} email
   * @returns {Promise<Object|null>}
   */
  static async findUserByEmail(email) {
    const text = `
      SELECT 
        id, 
        username, 
        email, 
        password_hash, 
        full_name, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active, 
        is_active AS "isActive", 
        created_at, 
        created_at AS "createdAt", 
        updated_at, 
        updated_at AS "updatedAt"
      FROM users
      WHERE LOWER(email) = LOWER($1);
    `;
    const res = await db.query(text, [email.trim()]);
    return res.rows[0] || null;
  }

  /**
   * Find a user by username (case-insensitive)
   * @param {string} username
   * @returns {Promise<Object|null>}
   */
  static async findUserByUsername(username) {
    const text = `
      SELECT 
        id, 
        username, 
        email, 
        password_hash, 
        full_name, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active, 
        is_active AS "isActive", 
        created_at, 
        created_at AS "createdAt", 
        updated_at, 
        updated_at AS "updatedAt"
      FROM users
      WHERE LOWER(username) = LOWER($1);
    `;
    const res = await db.query(text, [username.trim()]);
    return res.rows[0] || null;
  }

  /**
   * Find a user by ID with optional database transaction client
   * @param {number|string} id
   * @param {Object} [client]
   * @returns {Promise<Object|null>}
   */
  static async findUserById(id, client = null) {
    const executor = client || db;
    const text = `
      SELECT 
        id, 
        username, 
        email, 
        password_hash, 
        full_name, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active, 
        is_active AS "isActive", 
        created_at, 
        created_at AS "createdAt", 
        updated_at, 
        updated_at AS "updatedAt"
      FROM users
      WHERE id = $1;
    `;
    const res = await executor.query(text, [id]);
    return res.rows[0] || null;
  }

  /**
   * Find a user by ID with exclusive row lock inside an active transaction
   * @param {number|string} id
   * @param {Object} client - PostgreSQL transaction client
   * @returns {Promise<Object|null>}
   */
  static async findUserByIdForUpdate(id, client) {
    if (!client) {
      throw new Error('findUserByIdForUpdate requires an active transaction client');
    }
    const text = `
      SELECT 
        id, 
        username, 
        email, 
        password_hash, 
        full_name, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active, 
        is_active AS "isActive", 
        created_at, 
        created_at AS "createdAt", 
        updated_at, 
        updated_at AS "updatedAt"
      FROM users
      WHERE id = $1
      FOR UPDATE;
    `;
    const res = await client.query(text, [id]);
    return res.rows[0] || null;
  }

  /**
   * Count active Super Admin accounts with optional row lock
   * @param {Object} [client]
   * @param {boolean} [lock=false]
   * @returns {Promise<number>}
   */
  static async countActiveSuperAdmins(client = null, lock = false) {
    const executor = client || db;
    if (lock && client) {
      const lockRes = await client.query(`
        SELECT id FROM users WHERE role = 'super_admin' AND is_active = true FOR UPDATE;
      `);
      return lockRes.rows.length;
    }
    const res = await executor.query(`
      SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin' AND is_active = true;
    `);
    return res.rows[0].count;
  }

  /**
   * Administrative User Listing with parameterized filtering & bounded pagination
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  static async findAllUsers({ page = 1, limit = 20, role, status, search }) {
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (parsedPage - 1) * parsedLimit;

    const conditions = [];
    const values = [];

    // Role filter
    const ALLOWED_ROLES = ['student', 'professor', 'contest_admin', 'super_admin'];
    if (role && typeof role === 'string' && ALLOWED_ROLES.includes(role.trim().toLowerCase())) {
      values.push(role.trim().toLowerCase());
      conditions.push(`u.role = $${values.length}`);
    }

    // Status filter
    if (status !== undefined && status !== null && String(status).trim() !== '') {
      const statusStr = String(status).trim().toLowerCase();
      if (statusStr === 'true' || statusStr === 'active') {
        conditions.push(`u.is_active = true`);
      } else if (statusStr === 'false' || statusStr === 'inactive') {
        conditions.push(`u.is_active = false`);
      }
    }

    // Search filter (username, email, full_name)
    if (search && typeof search === 'string' && search.trim().length > 0) {
      values.push(`%${search.trim().toLowerCase()}%`);
      const idx = values.length;
      conditions.push(`(LOWER(u.username) LIKE $${idx} OR LOWER(u.email) LIKE $${idx} OR LOWER(u.full_name) LIKE $${idx})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total Count Query
    const countSql = `SELECT COUNT(*)::int AS total FROM users u ${whereClause};`;
    const countRes = await db.query(countSql, values);
    const total = countRes.rows[0].total;

    // Data Query (Strictly omits password_hash)
    const dataValues = [...values, parsedLimit, offset];
    const limitIdx = dataValues.length - 1;
    const offsetIdx = dataValues.length;

    const dataSql = `
      SELECT 
        u.id, 
        u.username, 
        u.email, 
        u.full_name AS "fullName", 
        u.role, 
        u.bio, 
        u.avatar_url AS "avatarUrl", 
        u.institution,
        u.current_rating AS "currentRating",
        u.highest_rating AS "highestRating",
        u.rating_status AS "ratingStatus",
        u.rated_contest_count AS "ratedContestCount",
        u.is_active AS "isActive", 
        u.created_at AS "createdAt", 
        u.updated_at AS "updatedAt"
      FROM users u
      ${whereClause}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const dataRes = await db.query(dataSql, dataValues);
    const totalPages = Math.ceil(total / parsedLimit) || 1;

    return {
      users: dataRes.rows,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages,
        hasNextPage: parsedPage < totalPages,
        hasPrevPage: parsedPage > 1,
      },
    };
  }

  /**
   * Create an administrative user with explicit role and status
   */
  static async createAdminUser(
    { username, email, passwordHash, fullName, role = 'student', isActive = true, bio = '', avatarUrl = '', institution = '' },
    client = null
  ) {
    const executor = client || db;
    const text = `
      INSERT INTO users (username, email, password_hash, full_name, role, is_active, bio, avatar_url, institution, current_rating, highest_rating, rating_status, rated_contest_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1200, 1200, 'provisional', 0)
      RETURNING 
        id, 
        username, 
        email, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active AS "isActive", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [
      username.trim(),
      email.trim().toLowerCase(),
      passwordHash,
      fullName.trim(),
      role,
      isActive,
      bio || '',
      avatarUrl || '',
      institution ? institution.trim() : '',
    ];
    const res = await executor.query(text, values);
    return res.rows[0];
  }

  /**
   * Update allowed profile fields for admin management
   */
  static async updateUserAdmin(id, { username, email, fullName, bio, avatarUrl, institution }, client = null) {
    const executor = client || db;
    const text = `
      UPDATE users
      SET 
        full_name = COALESCE($1, full_name),
        username = COALESCE($2, username),
        email = COALESCE($3, email),
        bio = COALESCE($4, bio),
        avatar_url = COALESCE($5, avatar_url),
        institution = COALESCE($6, institution),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING 
        id, 
        username, 
        email, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active AS "isActive", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [
      fullName !== undefined ? fullName.trim() : null,
      username !== undefined ? username.trim() : null,
      email !== undefined ? email.trim().toLowerCase() : null,
      bio !== undefined ? bio.trim() : null,
      avatarUrl !== undefined ? avatarUrl.trim() : null,
      institution !== undefined ? institution.trim() : null,
      id,
    ];
    const res = await executor.query(text, values);
    return res.rows[0] || null;
  }

  /**
   * Update user role
   */
  static async updateUserRole(id, role, client = null) {
    const executor = client || db;
    const text = `
      UPDATE users
      SET 
        role = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING 
        id, 
        username, 
        email, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active AS "isActive", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await executor.query(text, [role, id]);
    return res.rows[0] || null;
  }

  /**
   * Update user active status
   */
  static async updateUserStatus(id, isActive, client = null) {
    const executor = client || db;
    const text = `
      UPDATE users
      SET 
        is_active = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING 
        id, 
        username, 
        email, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active AS "isActive", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await executor.query(text, [isActive, id]);
    return res.rows[0] || null;
  }

  /**
   * Update allowed profile fields for a user (fullName, username, bio, avatarUrl, institution)
   */
  static async updateUserProfile(id, { fullName, username, bio, avatarUrl, institution }) {
    const text = `
      UPDATE users
      SET 
        full_name = COALESCE($1, full_name),
        username = COALESCE($2, username),
        bio = COALESCE($3, bio),
        avatar_url = COALESCE($4, avatar_url),
        institution = COALESCE($5, institution),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING 
        id, 
        username, 
        email, 
        full_name, 
        full_name AS "fullName", 
        role, 
        bio, 
        avatar_url, 
        avatar_url AS "avatarUrl", 
        institution,
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount",
        is_active, 
        is_active AS "isActive", 
        created_at, 
        created_at AS "createdAt", 
        updated_at, 
        updated_at AS "updatedAt";
    `;
    const values = [
      fullName !== undefined ? fullName.trim() : null,
      username !== undefined ? username.trim() : null,
      bio !== undefined ? bio.trim() : null,
      avatarUrl !== undefined ? avatarUrl.trim() : null,
      institution !== undefined ? institution.trim() : null,
      id,
    ];
    const res = await db.query(text, values);
    return res.rows[0] || null;
  }

  /**
   * Fetch public profile without exposing sensitive fields
   */
  static async getPublicProfile(idOrUsername) {
    const isNumeric = !isNaN(idOrUsername) && !isNaN(parseFloat(idOrUsername));
    const condition = isNumeric ? 'u.id = $1' : 'LOWER(u.username) = LOWER($1)';

    const text = `
      SELECT 
        u.id,
        u.username,
        u.full_name AS "fullName",
        u.role,
        u.bio,
        u.avatar_url AS "avatarUrl",
        u.institution,
        u.current_rating AS "currentRating",
        u.highest_rating AS "highestRating",
        u.rating_status AS "ratingStatus",
        u.rated_contest_count AS "ratedContestCount",
        u.created_at AS "createdAt",
        (SELECT COUNT(DISTINCT problem_id)::int FROM submissions WHERE user_id = u.id AND status = 'accepted' AND is_sample_run = false) AS "problemsSolvedCount",
        (SELECT COUNT(*)::int FROM contest_participants WHERE user_id = u.id) AS "contestsJoinedCount",
        (SELECT COUNT(*)::int FROM contest_participants WHERE user_id = u.id) AS "contestsCount"
      FROM users u
      WHERE ${condition} AND u.is_active = true;
    `;
    const res = await db.query(text, [idOrUsername]);
    return res.rows[0] || null;
  }
}

module.exports = UserModel;