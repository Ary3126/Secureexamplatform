const db = require('../config/db');
const RATING_CONFIG = require('../config/ratingConfig');
const RatingModel = require('../models/ratingModel');
const AuditLogger = require('./auditLogger');

/**
 * Global & College Ranking Service - Single Authoritative Platform-wide Standings Engine (Phase 5.6)
 */
class GlobalRankingService {
  /**
   * Fetch platform leaderboard with deterministic ranking, server-side pagination, filters,
   * logged-in user position summary, platform statistics, and rating distribution.
   * 
   * @param {Object} options
   * @param {string} [options.scope='global'] - 'global' | 'college'
   * @param {string} [options.institution=''] - College / Institution name filter
   * @param {string} [options.status='all'] - 'all' | 'rated' | 'provisional'
   * @param {string} [options.tier='all'] - Specific tier name ('Elite', 'Master', 'Specialist', 'Expert', 'Challenger', 'Explorer')
   * @param {string} [options.search=''] - Search term for username or full name
   * @param {number} [options.page=1] - 1-indexed page
   * @param {number} [options.limit=50] - Items per page
   * @param {number|null} [options.requestingUserId=null] - Logged-in user ID for position lookup
   * @returns {Promise<Object>} Formatted leaderboard response
   */
  static async getLeaderboard({
    scope = 'global',
    institution = '',
    status = 'all',
    tier = 'all',
    search = '',
    page = 1,
    limit = 50,
    requestingUserId = null,
  }) {
    const validLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
    const validPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (validPage - 1) * validLimit;

    // 1. Build dynamic WHERE clauses
    const whereClauses = [`u.role = 'student'`, `u.is_active = true`];
    const params = [];

    // College / Institution filter
    const activeInstitution = (scope === 'college' && institution) ? institution.trim() : (institution ? institution.trim() : '');
    if (activeInstitution) {
      params.push(activeInstitution.toLowerCase());
      whereClauses.push(`LOWER(u.institution) = $${params.length}`);
    }

    // Status filter (rated vs provisional)
    if (status === 'rated') {
      whereClauses.push(`u.rating_status = 'rated'`);
    } else if (status === 'provisional') {
      whereClauses.push(`u.rating_status = 'provisional'`);
    }

    // Tier filter
    if (tier && tier !== 'all') {
      const selectedTier = RATING_CONFIG.TIERS.find(
        (t) => t.name.toLowerCase() === tier.toLowerCase() || t.badge.toLowerCase() === tier.toLowerCase()
      );
      if (selectedTier) {
        params.push(selectedTier.minRating);
        whereClauses.push(`u.current_rating >= $${params.length}`);
        if (selectedTier.maxRating !== Infinity) {
          params.push(selectedTier.maxRating);
          whereClauses.push(`u.current_rating <= $${params.length}`);
        }
      }
    }

    // Search query filter
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      whereClauses.push(
        `(LOWER(u.username) LIKE $${params.length} OR LOWER(u.full_name) LIKE $${params.length})`
      );
    }

    const whereSql = whereClauses.join(' AND ');

    // 2. Count total matching users for pagination
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM users u
      WHERE ${whereSql};
    `;
    const countRes = await db.query(countSql, params);
    const totalMatchingUsers = countRes.rows[0]?.total || 0;
    const totalPages = Math.ceil(totalMatchingUsers / validLimit) || 1;

    // 3. Fetch ranked page rows with deterministic ranking
    // Rank is computed globally across the active filter scope using ROW_NUMBER()
    const queryParams = [...params, validLimit, offset];
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;

    const standingsSql = `
      WITH ranked_students AS (
        SELECT 
          u.id AS "userId",
          u.username,
          u.full_name AS "fullName",
          u.avatar_url AS "avatarUrl",
          COALESCE(u.institution, '') AS "institution",
          u.current_rating AS "currentRating",
          u.highest_rating AS "highestRating",
          u.rating_status AS "ratingStatus",
          u.rated_contest_count AS "ratedContestCount",
          u.created_at AS "createdAt",
          COALESCE(sub_stats.solved_count, 0)::int AS "problemsSolvedCount",
          ROW_NUMBER() OVER (ORDER BY u.current_rating DESC, u.id ASC) AS rank
        FROM users u
        LEFT JOIN (
          SELECT user_id, COUNT(DISTINCT problem_id) AS solved_count
          FROM submissions
          WHERE status = 'accepted' AND is_sample_run = false
          GROUP BY user_id
        ) sub_stats ON u.id = sub_stats.user_id
        WHERE ${whereSql}
      )
      SELECT *
      FROM ranked_students
      ORDER BY rank ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const standingsRes = await db.query(standingsSql, queryParams);

    // 4. Enrich standings rows with Tier data and optional movement
    const standings = standingsRes.rows.map((row) => {
      const tierObj = RATING_CONFIG.getTierForRating(row.currentRating);
      return {
        rank: parseInt(row.rank, 10),
        userId: row.userId,
        username: row.username,
        fullName: row.fullName,
        avatarUrl: row.avatarUrl,
        institution: row.institution,
        currentRating: row.currentRating,
        highestRating: row.highestRating,
        ratingStatus: row.ratingStatus,
        ratedContestCount: row.ratedContestCount,
        problemsSolvedCount: row.problemsSolvedCount,
        tier: {
          name: tierObj.name,
          badge: tierObj.badge,
          color: tierObj.color,
          bg: tierObj.bg,
          description: tierObj.description,
        },
        rankMovement: null, // Historical snapshot delta if present
      };
    });

    // 5. Fetch Top 3 Podium (top 3 rank holders globally or within college filter)
    let podium = [];
    if (validPage === 1 && standings.length >= 3) {
      podium = standings.slice(0, 3);
    } else {
      // If user is on page 2+, fetch authoritative top 3 separately
      const podiumParams = [...params];
      const podiumSql = `
        SELECT 
          u.id AS "userId",
          u.username,
          u.full_name AS "fullName",
          u.avatar_url AS "avatarUrl",
          COALESCE(u.institution, '') AS "institution",
          u.current_rating AS "currentRating",
          u.highest_rating AS "highestRating",
          u.rating_status AS "ratingStatus",
          u.rated_contest_count AS "ratedContestCount",
          COALESCE(sub_stats.solved_count, 0)::int AS "problemsSolvedCount",
          ROW_NUMBER() OVER (ORDER BY u.current_rating DESC, u.id ASC) AS rank
        FROM users u
        LEFT JOIN (
          SELECT user_id, COUNT(DISTINCT problem_id) AS solved_count
          FROM submissions
          WHERE status = 'accepted' AND is_sample_run = false
          GROUP BY user_id
        ) sub_stats ON u.id = sub_stats.user_id
        WHERE ${whereSql}
        ORDER BY rank ASC
        LIMIT 3;
      `;
      const podiumRes = await db.query(podiumSql, podiumParams);
      podium = podiumRes.rows.map((row) => {
        const tierObj = RATING_CONFIG.getTierForRating(row.currentRating);
        return {
          rank: parseInt(row.rank, 10),
          userId: row.userId,
          username: row.username,
          fullName: row.fullName,
          avatarUrl: row.avatarUrl,
          institution: row.institution,
          currentRating: row.currentRating,
          highestRating: row.highestRating,
          ratingStatus: row.ratingStatus,
          ratedContestCount: row.ratedContestCount,
          problemsSolvedCount: row.problemsSolvedCount,
          tier: {
            name: tierObj.name,
            badge: tierObj.badge,
            color: tierObj.color,
            bg: tierObj.bg,
            description: tierObj.description,
          },
        };
      });
    }

    // 6. Compute Logged-in User's Position Summary (Global Rank & College Rank)
    let userPosition = null;
    if (requestingUserId) {
      userPosition = await this.getUserPositionSummary(requestingUserId);
    }

    // 7. Calculate Platform-Level Statistics & Rating Distribution
    const statistics = await this.getPlatformStatistics();

    // 8. Fetch distinct institutions list for quick college filter
    const institutionsRes = await db.query(`
      SELECT institution, COUNT(*)::int AS "studentCount"
      FROM users
      WHERE role = 'student' AND is_active = true AND institution != '' AND institution IS NOT NULL
      GROUP BY institution
      ORDER BY "studentCount" DESC, institution ASC;
    `);

    return {
      scope: activeInstitution ? 'college' : 'global',
      institution: activeInstitution || null,
      filters: {
        status,
        tier,
        search,
      },
      standings,
      podium,
      userPosition,
      pagination: {
        currentPage: validPage,
        totalPages,
        totalUsers: totalMatchingUsers,
        limit: validLimit,
        hasNext: validPage < totalPages,
        hasPrev: validPage > 1,
      },
      statistics,
      availableInstitutions: institutionsRes.rows,
      tiers: RATING_CONFIG.TIERS,
    };
  }

  /**
   * Compute comprehensive rank summary for a specific user
   * (Global Rank, College Rank, Rating, Tier, Percentile)
   * 
   * @param {number} userId
   * @returns {Promise<Object|null>}
   */
  static async getUserPositionSummary(userId) {
    const userRes = await db.query(
      `
      SELECT 
        u.id, 
        u.username, 
        u.full_name AS "fullName",
        u.avatar_url AS "avatarUrl",
        COALESCE(u.institution, '') AS "institution",
        u.current_rating AS "currentRating", 
        u.highest_rating AS "highestRating", 
        u.rating_status AS "ratingStatus", 
        u.rated_contest_count AS "ratedContestCount",
        COALESCE(sub_stats.solved_count, 0)::int AS "problemsSolvedCount"
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(DISTINCT problem_id) AS solved_count
        FROM submissions
        WHERE status = 'accepted' AND is_sample_run = false
        GROUP BY user_id
      ) sub_stats ON u.id = sub_stats.user_id
      WHERE u.id = $1 AND u.role = 'student' AND u.is_active = true;
      `,
      [userId]
    );

    if (!userRes.rows[0]) return null;
    const u = userRes.rows[0];

    // 1. Authoritative Global Rank
    const globalRankRes = await db.query(
      `
      SELECT COUNT(*)::int + 1 AS rank
      FROM users
      WHERE role = 'student' 
        AND is_active = true
        AND (current_rating > $1 OR (current_rating = $1 AND id < $2));
      `,
      [u.currentRating, userId]
    );
    const globalRank = globalRankRes.rows[0] ? globalRankRes.rows[0].rank : 1;

    // 2. Authoritative College Rank (if student has institution)
    let collegeRank = null;
    let totalCollegeStudents = null;
    if (u.institution) {
      const collegeRankRes = await db.query(
        `
        SELECT COUNT(*)::int + 1 AS rank
        FROM users
        WHERE role = 'student' 
          AND is_active = true
          AND LOWER(institution) = LOWER($1)
          AND (current_rating > $2 OR (current_rating = $2 AND id < $3));
        `,
        [u.institution, u.currentRating, userId]
      );
      collegeRank = collegeRankRes.rows[0] ? collegeRankRes.rows[0].rank : 1;

      const totalColRes = await db.query(
        `SELECT COUNT(*)::int AS total FROM users WHERE role = 'student' AND is_active = true AND LOWER(institution) = LOWER($1);`,
        [u.institution]
      );
      totalCollegeStudents = totalColRes.rows[0]?.total || 1;
    }

    // 3. Percentile computation
    const totalStudentsRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM users WHERE role = 'student' AND is_active = true;`
    );
    const totalStudents = totalStudentsRes.rows[0]?.total || 1;
    const percentile = Math.max(
      1,
      Math.min(100, Math.round(((totalStudents - globalRank + 1) / totalStudents) * 100))
    );

    const tierObj = RATING_CONFIG.getTierForRating(u.currentRating);

    return {
      userId: u.id,
      username: u.username,
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      institution: u.institution,
      currentRating: u.currentRating,
      highestRating: u.highestRating,
      ratingStatus: u.ratingStatus,
      ratedContestCount: u.ratedContestCount,
      problemsSolvedCount: u.problemsSolvedCount,
      globalRank,
      collegeRank,
      totalCollegeStudents,
      totalStudents,
      percentile,
      tier: {
        name: tierObj.name,
        badge: tierObj.badge,
        color: tierObj.color,
        bg: tierObj.bg,
        description: tierObj.description,
      },
    };
  }

  /**
   * Compute real platform rating statistics and distribution histogram
   * @returns {Promise<Object>}
   */
  static async getPlatformStatistics() {
    const statsRes = await db.query(`
      SELECT 
        COUNT(*)::int AS "totalStudents",
        COUNT(CASE WHEN rating_status = 'rated' THEN 1 END)::int AS "ratedStudents",
        COUNT(CASE WHEN rating_status = 'provisional' THEN 1 END)::int AS "provisionalStudents",
        COALESCE(ROUND(AVG(current_rating)), 1200)::int AS "averageRating",
        COALESCE(MAX(current_rating), 1200)::int AS "highestRating",
        COALESCE(MIN(current_rating), 1200)::int AS "lowestRating"
      FROM users
      WHERE role = 'student' AND is_active = true;
    `);

    const summary = statsRes.rows[0] || {
      totalStudents: 0,
      ratedStudents: 0,
      provisionalStudents: 0,
      averageRating: 1200,
      highestRating: 1200,
      lowestRating: 1200,
    };

    // Calculate rating distribution histogram from real user data
    const totalCount = summary.totalStudents || 1;
    const ratingDistribution = [];

    for (const bucket of RATING_CONFIG.DISTRIBUTION_BUCKETS) {
      const bucketRes = await db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE role = 'student' 
          AND is_active = true
          AND current_rating >= $1 
          AND current_rating <= $2;
        `,
        [bucket.min, bucket.max]
      );
      const count = bucketRes.rows[0]?.count || 0;
      const percentage = parseFloat(((count / totalCount) * 100).toFixed(1));

      ratingDistribution.push({
        range: bucket.label,
        tierName: bucket.tierName,
        min: bucket.min,
        max: bucket.max,
        color: bucket.color,
        count,
        percentage,
      });
    }

    return {
      ...summary,
      ratingDistribution,
    };
  }

  /**
   * Create a historical leaderboard snapshot for global or college scope
   * @param {Object} options
   * @param {string} [options.scope='global']
   * @param {string} [options.institution='']
   * @returns {Promise<Object>} Snapshot summary
   */
  static async createLeaderboardSnapshot({ scope = 'global', institution = '' } = {}, actor = null, req = null) {
    const activeInstitution = (scope === 'college' && institution) ? institution.trim() : '';

    const whereClauses = [`u.role = 'student'`, `u.is_active = true`];
    const params = [];
    if (activeInstitution) {
      params.push(activeInstitution.toLowerCase());
      whereClauses.push(`LOWER(u.institution) = $1`);
    }

    const studentsSql = `
      SELECT 
        u.id AS "userId",
        u.current_rating AS rating,
        u.highest_rating AS "highestRating",
        u.rating_status AS "ratingStatus",
        u.rated_contest_count AS "ratedContestCount",
        ROW_NUMBER() OVER (ORDER BY u.current_rating DESC, u.id ASC) AS rank
      FROM users u
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY rank ASC;
    `;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const studentsRes = await client.query(studentsSql, params);
      const rows = studentsRes.rows;

      let insertedCount = 0;
      for (const s of rows) {
        await client.query(
          `
          INSERT INTO leaderboard_snapshots (
            snapshot_date, scope, institution, user_id, rank, rating, highest_rating, rating_status, rated_contest_count
          )
          VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (scope, institution, snapshot_date, user_id) 
          DO UPDATE SET rank = EXCLUDED.rank, rating = EXCLUDED.rating, highest_rating = EXCLUDED.highest_rating;
          `,
          [
            scope,
            activeInstitution,
            s.userId,
            parseInt(s.rank, 10),
            s.rating,
            s.highestRating,
            s.ratingStatus,
            s.ratedContestCount,
          ]
        );
        insertedCount++;
      }

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'LEADERBOARD_SNAPSHOT_CREATED',
          resourceType: 'snapshot',
          resourceId: null,
          outcome: 'success',
          metadata: { scope, institution: activeInstitution || 'ALL', totalStudentsCaptured: insertedCount },
          client,
          req,
        });
      }

      await client.query('COMMIT');

      return {
        message: `Snapshot created successfully for ${insertedCount} students`,
        scope,
        institution: activeInstitution || null,
        snapshotDate: new Date().toISOString().split('T')[0],
        totalStudentsCaptured: insertedCount,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch historical snapshot records
   * @param {Object} options
   */
  static async getSnapshots({ scope = 'global', institution = '', date = null, limit = 50 } = {}) {
    const where = [`scope = $1`];
    const params = [scope];

    if (institution) {
      params.push(institution.trim());
      where.push(`institution = $${params.length}`);
    }
    if (date) {
      params.push(date);
      where.push(`snapshot_date = $${params.length}`);
    }

    params.push(limit);
    const sql = `
      SELECT 
        ls.id,
        ls.snapshot_date AS "snapshotDate",
        ls.scope,
        ls.institution,
        ls.user_id AS "userId",
        u.username,
        u.full_name AS "fullName",
        ls.rank,
        ls.rating,
        ls.highest_rating AS "highestRating",
        ls.rating_status AS "ratingStatus",
        ls.created_at AS "createdAt"
      FROM leaderboard_snapshots ls
      JOIN users u ON ls.user_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY ls.snapshot_date DESC, ls.rank ASC
      LIMIT $${params.length};
    `;

    const res = await db.query(sql, params);
    return res.rows;
  }
}

module.exports = GlobalRankingService;
