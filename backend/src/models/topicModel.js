const db = require('../config/db');

/**
 * TopicModel - Canonical Topic Representation & Problem Associations
 * Manages algorithmic topics and multi-topic mappings for problems.
 */
class TopicModel {
  /**
   * Get all registered topics
   * @returns {Promise<Array>}
   */
  static async getAllTopics() {
    const text = `
      SELECT 
        id, 
        key, 
        name, 
        category, 
        description, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
      FROM topics
      ORDER BY category ASC, name ASC;
    `;
    const res = await db.query(text);
    return res.rows;
  }

  /**
   * Get topic by unique key
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  static async getTopicByKey(key) {
    const text = `
      SELECT 
        id, 
        key, 
        name, 
        category, 
        description, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
      FROM topics
      WHERE LOWER(key) = LOWER($1);
    `;
    const res = await db.query(text, [key]);
    return res.rows[0] || null;
  }

  /**
   * Get topic by ID
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  static async getTopicById(id) {
    const text = `
      SELECT 
        id, 
        key, 
        name, 
        category, 
        description, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
      FROM topics
      WHERE id = $1;
    `;
    const res = await db.query(text, [id]);
    return res.rows[0] || null;
  }

  /**
   * Create or register a new topic
   * @param {Object} topicData
   */
  static async createTopic({ key, name, category = 'Algorithms', description = '' }) {
    const text = `
      INSERT INTO topics (key, name, category, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET 
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id, 
        key, 
        name, 
        category, 
        description, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await db.query(text, [key.toLowerCase().trim(), name.trim(), category.trim(), description.trim()]);
    return res.rows[0];
  }

  /**
   * Get all topics associated with a problem
   * @param {number} problemId
   * @returns {Promise<Array>}
   */
  static async getTopicsByProblemId(problemId) {
    const text = `
      SELECT 
        t.id, 
        t.key, 
        t.name, 
        t.category, 
        t.description
      FROM topics t
      JOIN problem_topics pt ON t.id = pt.topic_id
      WHERE pt.problem_id = $1
      ORDER BY t.name ASC;
    `;
    const res = await db.query(text, [problemId]);
    return res.rows;
  }

  /**
   * Assign topics to a problem (replaces existing associations safely)
   * @param {number} problemId
   * @param {Array<number>} topicIds
   */
  static async assignTopicsToProblem(problemId, topicIds = []) {
    if (!Array.isArray(topicIds) || topicIds.length === 0) {
      return [];
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Remove existing associations for this problem
      await client.query('DELETE FROM problem_topics WHERE problem_id = $1;', [problemId]);

      // Insert new associations
      for (const topicId of topicIds) {
        await client.query(
          `INSERT INTO problem_topics (problem_id, topic_id) 
           VALUES ($1, $2) 
           ON CONFLICT (problem_id, topic_id) DO NOTHING;`,
          [problemId, topicId]
        );
      }

      await client.query('COMMIT');
      return await this.getTopicsByProblemId(problemId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Add a single topic to a problem without clearing others
   * @param {number} problemId
   * @param {number} topicId
   */
  static async addTopicToProblem(problemId, topicId) {
    const text = `
      INSERT INTO problem_topics (problem_id, topic_id)
      VALUES ($1, $2)
      ON CONFLICT (problem_id, topic_id) DO NOTHING
      RETURNING problem_id, topic_id;
    `;
    const res = await db.query(text, [problemId, topicId]);
    return res.rows[0] || null;
  }

  /**
   * Auto-tag problems based on keywords if they do not yet have topics
   */
  static async autoTagProblemByKeywords(problemId, title, description) {
    const textToSearch = `${title} ${description}`.toLowerCase();
    const allTopics = await this.getAllTopics();

    const topicKeywords = {
      arrays: ['array', 'subarray', 'matrix', 'vector', 'list', 'element', 'two sum'],
      strings: ['string', 'substring', 'palindrome', 'anagram', 'prefix', 'char', 'text'],
      hashing: ['hash', 'map', 'hashmap', 'frequency', 'lookup', 'dictionary'],
      two_pointers: ['two pointer', 'two-pointer', 'converge', 'pointers', 'two sum'],
      sliding_window: ['sliding window', 'subarray with length', 'window', 'continuous'],
      binary_search: ['binary search', 'search in sorted', 'sorted array', 'logarithmic', 'find target'],
      linked_list: ['linked list', 'node', 'head', 'tail', 'singly linked', 'doubly linked'],
      stack_queue: ['stack', 'queue', 'deque', 'monotonic', 'lifo', 'fifo'],
      trees: ['tree', 'binary tree', 'bst', 'traversal', 'leaf', 'root', 'depth'],
      graphs: ['graph', 'bfs', 'dfs', 'shortest path', 'dijkstra', 'cycle', 'edge', 'vertex'],
      heap: ['heap', 'priority queue', 'top k', 'min heap', 'max heap'],
      greedy: ['greedy', 'interval', 'activity selection', 'fractional'],
      dp: ['dp', 'dynamic programming', 'subsequence', 'knapsack', 'memoization', 'fibonacci'],
      backtracking: ['backtracking', 'n-queens', 'permutations', 'subsets', 'combination sum'],
      bit_manipulation: ['bit', 'bitwise', 'xor', 'and', 'or', 'binary representation', 'mask'],
      math: ['math', 'sum', 'add', 'multiply', 'prime', 'modulo', 'arithmetic', 'number', 'calculate', 'digit']
    };

    const matchedTopicIds = [];
    for (const topic of allTopics) {
      const kws = topicKeywords[topic.key] || [];
      if (kws.some((kw) => textToSearch.includes(kw))) {
        matchedTopicIds.push(topic.id);
      }
    }

    if (matchedTopicIds.length === 0) {
      // Default to Math
      const mathTopic = allTopics.find((t) => t.key === 'math');
      if (mathTopic) matchedTopicIds.push(mathTopic.id);
    }

    for (const tId of matchedTopicIds) {
      await this.addTopicToProblem(problemId, tId);
    }

    return matchedTopicIds;
  }
}

module.exports = TopicModel;
