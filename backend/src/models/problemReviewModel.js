const db = require('../config/db');

/**
 * ProblemReviewModel - Handles database interactions for Problem Review & Approval Governance
 */
class ProblemReviewModel {
  /**
   * Create a new review request for a specific problem version
   */
  static async createReviewRequest({ problemId, problemVersion, submittedBy }, client = null) {
    const text = `
      INSERT INTO problem_reviews (problem_id, problem_version, submitted_by, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING 
        id, 
        problem_id AS "problemId", 
        problem_version AS "problemVersion", 
        submitted_by AS "submittedBy", 
        reviewer_id AS "reviewerId", 
        status, 
        decision_reason AS "decisionReason", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await (client || db).query(text, [problemId, problemVersion, submittedBy]);
    return res.rows[0];
  }

  /**
   * Find active review (pending or in_review) for a specific problem
   */
  static async findActiveReviewForProblem(problemId, client = null) {
    const text = `
      SELECT 
        r.id, 
        r.problem_id AS "problemId", 
        r.problem_version AS "problemVersion", 
        r.submitted_by AS "submittedBy", 
        r.reviewer_id AS "reviewerId", 
        r.status, 
        r.decision_reason AS "decisionReason", 
        r.created_at AS "createdAt", 
        r.updated_at AS "updatedAt"
      FROM problem_reviews r
      WHERE r.problem_id = $1 AND r.status IN ('pending', 'in_review')
      ORDER BY r.id DESC
      LIMIT 1;
    `;
    const res = await (client || db).query(text, [problemId]);
    return res.rows[0] || null;
  }

  /**
   * Find a review by its ID with problem metadata and author/reviewer details
   */
  static async findReviewById(reviewId, client = null) {
    const text = `
      SELECT 
        r.id, 
        r.problem_id AS "problemId", 
        p.title AS "problemTitle",
        p.difficulty AS "problemDifficulty",
        p.coding_mode AS "problemCodingMode",
        p.version AS "currentProblemVersion",
        p.access_scope AS "problemAccessScope",
        p.created_by AS "problemAuthorId",
        r.problem_version AS "problemVersion", 
        r.submitted_by AS "submittedBy", 
        sub_u.username AS "submitterUsername",
        sub_u.full_name AS "submitterFullName",
        r.reviewer_id AS "reviewerId", 
        rev_u.username AS "reviewerUsername",
        rev_u.full_name AS "reviewerFullName",
        r.status, 
        r.decision_reason AS "decisionReason", 
        r.created_at AS "createdAt", 
        r.updated_at AS "updatedAt"
      FROM problem_reviews r
      JOIN problems p ON r.problem_id = p.id
      JOIN users sub_u ON r.submitted_by = sub_u.id
      LEFT JOIN users rev_u ON r.reviewer_id = rev_u.id
      WHERE r.id = $1;
    `;
    const res = await (client || db).query(text, [reviewId]);
    return res.rows[0] || null;
  }

  /**
   * Start review assignment
   */
  static async startReview(reviewId, reviewerId, client = null) {
    const text = `
      UPDATE problem_reviews
      SET reviewer_id = $2, status = 'in_review', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'pending'
      RETURNING 
        id, 
        problem_id AS "problemId", 
        problem_version AS "problemVersion", 
        submitted_by AS "submittedBy", 
        reviewer_id AS "reviewerId", 
        status, 
        decision_reason AS "decisionReason", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await (client || db).query(text, [reviewId, reviewerId]);
    return res.rows[0] || null;
  }

  /**
   * Record review decision (changes_requested, rejected, approved)
   */
  static async recordDecision(reviewId, reviewerId, status, decisionReason = null, client = null) {
    const text = `
      UPDATE problem_reviews
      SET 
        reviewer_id = COALESCE($2, reviewer_id),
        status = $3,
        decision_reason = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING 
        id, 
        problem_id AS "problemId", 
        problem_version AS "problemVersion", 
        submitted_by AS "submittedBy", 
        reviewer_id AS "reviewerId", 
        status, 
        decision_reason AS "decisionReason", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await (client || db).query(text, [reviewId, reviewerId, status, decisionReason]);
    return res.rows[0] || null;
  }

  /**
   * Revoke/Supercede any open reviews for a problem when problem is edited
   */
  static async revokeActiveReviewsForProblem(problemId, client = null) {
    const text = `
      UPDATE problem_reviews
      SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
      WHERE problem_id = $1 AND status IN ('pending', 'in_review')
      RETURNING id;
    `;
    const res = await (client || db).query(text, [problemId]);
    return res.rowCount;
  }

  /**
   * Add a persistent review comment
   */
  static async addComment({ reviewId, authorId, commentType = 'general', comment }, client = null) {
    const text = `
      INSERT INTO problem_review_comments (review_id, author_id, comment_type, comment)
      VALUES ($1, $2, $3, $4)
      RETURNING 
        id, 
        review_id AS "reviewId", 
        author_id AS "authorId", 
        comment_type AS "commentType", 
        comment, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await (client || db).query(text, [reviewId, authorId, commentType, comment]);
    return res.rows[0];
  }

  /**
   * Find comments for a review
   */
  static async findReviewComments(reviewId, client = null) {
    const text = `
      SELECT 
        c.id, 
        c.review_id AS "reviewId", 
        c.author_id AS "authorId", 
        u.username AS "authorUsername",
        u.full_name AS "authorFullName",
        u.role AS "authorRole",
        c.comment_type AS "commentType", 
        c.comment, 
        c.created_at AS "createdAt", 
        c.updated_at AS "updatedAt"
      FROM problem_review_comments c
      JOIN users u ON c.author_id = u.id
      WHERE c.review_id = $1
      ORDER BY c.created_at ASC, c.id ASC;
    `;
    const res = await (client || db).query(text, [reviewId]);
    return res.rows;
  }

  /**
   * Find all reviews for a specific problem
   */
  static async findReviewsByProblemId(problemId, client = null) {
    const text = `
      SELECT 
        r.id, 
        r.problem_id AS "problemId", 
        r.problem_version AS "problemVersion", 
        r.submitted_by AS "submittedBy", 
        sub_u.username AS "submitterUsername",
        sub_u.full_name AS "submitterFullName",
        r.reviewer_id AS "reviewerId", 
        rev_u.username AS "reviewerUsername",
        rev_u.full_name AS "reviewerFullName",
        r.status, 
        r.decision_reason AS "decisionReason", 
        r.created_at AS "createdAt", 
        r.updated_at AS "updatedAt",
        COUNT(c.id)::int AS "commentsCount"
      FROM problem_reviews r
      JOIN users sub_u ON r.submitted_by = sub_u.id
      LEFT JOIN users rev_u ON r.reviewer_id = rev_u.id
      LEFT JOIN problem_review_comments c ON r.id = c.review_id
      WHERE r.problem_id = $1
      GROUP BY r.id, sub_u.username, sub_u.full_name, rev_u.username, rev_u.full_name
      ORDER BY r.created_at DESC, r.id DESC;
    `;
    const res = await (client || db).query(text, [problemId]);
    return res.rows;
  }

  /**
   * Find review queue for admin / reviewer dashboard with search and filters
   */
  static async findReviewQueue({ status = null, difficulty = null, authorId = null, search = null, limit = 20, offset = 0 } = {}, client = null) {
    const conditions = [];
    const values = [];
    let idx = 1;

    if (status && status !== 'all') {
      conditions.push(`r.status = $${idx++}`);
      values.push(status);
    }
    if (difficulty && difficulty !== 'all') {
      conditions.push(`p.difficulty = $${idx++}`);
      values.push(difficulty.toLowerCase());
    }
    if (authorId) {
      conditions.push(`p.created_by = $${idx++}`);
      values.push(parseInt(authorId, 10));
    }
    if (search && search.trim()) {
      conditions.push(`(p.title ILIKE $${idx} OR sub_u.username ILIKE $${idx} OR sub_u.full_name ILIKE $${idx})`);
      values.push(`%${search.trim()}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countText = `
      SELECT COUNT(*)::int AS total
      FROM problem_reviews r
      JOIN problems p ON r.problem_id = p.id
      JOIN users sub_u ON r.submitted_by = sub_u.id
      ${whereClause};
    `;
    const countRes = await (client || db).query(countText, values);
    const total = countRes.rows[0]?.total || 0;

    const listText = `
      SELECT 
        r.id, 
        r.problem_id AS "problemId", 
        p.title AS "problemTitle",
        p.difficulty AS "problemDifficulty",
        p.coding_mode AS "problemCodingMode",
        p.version AS "currentProblemVersion",
        p.access_scope AS "problemAccessScope",
        p.created_by AS "problemAuthorId",
        r.problem_version AS "problemVersion", 
        r.submitted_by AS "submittedBy", 
        sub_u.username AS "submitterUsername",
        sub_u.full_name AS "submitterFullName",
        r.reviewer_id AS "reviewerId", 
        rev_u.username AS "reviewerUsername",
        rev_u.full_name AS "reviewerFullName",
        r.status, 
        r.decision_reason AS "decisionReason", 
        r.created_at AS "createdAt", 
        r.updated_at AS "updatedAt"
      FROM problem_reviews r
      JOIN problems p ON r.problem_id = p.id
      JOIN users sub_u ON r.submitted_by = sub_u.id
      LEFT JOIN users rev_u ON r.reviewer_id = rev_u.id
      ${whereClause}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $${idx++} OFFSET $${idx++};
    `;
    values.push(limit, offset);
    const listRes = await (client || db).query(listText, values);

    return {
      total,
      reviews: listRes.rows,
    };
  }
}

module.exports = ProblemReviewModel;
