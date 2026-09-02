const UserSkillModel = require('../models/userSkillModel');
const UserSkillHistoryModel = require('../models/userSkillHistoryModel');
const TopicModel = require('../models/topicModel');
const UserModel = require('../models/userModel');
const SkillCalculationService = require('../services/skillCalculationService');

/**
 * SkillController - REST Endpoints for Skill State, Classification, History & Topic Taxonomies
 */
class SkillController {
  /**
   * GET /api/skills/topics
   * Public / Authenticated: List all registered algorithmic topics
   */
  static async getTopics(req, res, next) {
    try {
      const topics = await TopicModel.getAllTopics();
      res.status(200).json({
        success: true,
        count: topics.length,
        topics,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/users/me/skills or GET /api/skills/my
   * Protected: Retrieve authenticated user's detailed skills state, classification summary & trends
   */
  static async getMySkills(req, res, next) {
    try {
      const userId = req.user.id;
      const skills = await UserSkillModel.getUserSkills(userId);
      const summary = await UserSkillModel.getUserSkillSummary(userId);
      const classificationSummary = SkillCalculationService.buildSkillClassificationSummary(skills);

      res.status(200).json({
        success: true,
        userId,
        count: skills.length,
        summary,
        classificationSummary,
        skills,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/skills/my/history
   * Protected: Retrieve authenticated user's progress history across all topics or specific topic
   */
  static async getMySkillHistory(req, res, next) {
    try {
      const userId = req.user.id;
      const { topicId, topicKey, limit, offset, startDate, endDate, order } = req.query;

      let resolvedTopicId = topicId ? parseInt(topicId, 10) : null;
      if (!resolvedTopicId && topicKey) {
        const topic = await TopicModel.getTopicByKey(topicKey);
        if (topic) {
          resolvedTopicId = topic.id;
        }
      }

      const history = await UserSkillHistoryModel.getHistory({
        userId,
        topicId: resolvedTopicId,
        limit,
        offset,
        startDate,
        endDate,
        order,
      });

      const overallTrends = await UserSkillHistoryModel.getUserOverallTrends(userId);

      res.status(200).json({
        success: true,
        userId,
        count: history.length,
        trends: overallTrends,
        history,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/skills/my/history/:topicKey
   * Protected: Retrieve authenticated user's progress history and deterministic trend for a specific topic
   */
  static async getMyTopicHistory(req, res, next) {
    try {
      const userId = req.user.id;
      const { topicKey } = req.params;
      const { limit, offset, startDate, endDate, order } = req.query;

      const topic = await TopicModel.getTopicByKey(topicKey);
      if (!topic) {
        return res.status(404).json({
          success: false,
          message: `Topic '${topicKey}' not found`,
        });
      }

      const currentSkill = await UserSkillModel.getUserSkillByTopic(userId, topic.id);
      const trend = await UserSkillHistoryModel.getTopicTrend(userId, topic.id);
      const history = await UserSkillHistoryModel.getHistory({
        userId,
        topicId: topic.id,
        limit,
        offset,
        startDate,
        endDate,
        order,
      });

      res.status(200).json({
        success: true,
        userId,
        topic: {
          id: topic.id,
          key: topic.key,
          name: topic.name,
          category: topic.category,
        },
        currentSkill,
        trend,
        count: history.length,
        history,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/skills/user/:idOrUsername
   * Public / Protected: Retrieve skills for a given user (scoped by ownership privacy)
   */
  static async getUserSkills(req, res, next) {
    try {
      const { idOrUsername } = req.params;
      const currentUserId = req.user ? req.user.id : null;

      let targetUser = null;
      if (/^\d+$/.test(idOrUsername)) {
        targetUser = await UserModel.findUserById(parseInt(idOrUsername, 10));
      } else {
        targetUser = await UserModel.findUserByUsername(idOrUsername);
      }

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: `User '${idOrUsername}' not found`,
        });
      }

      const isOwnProfile = currentUserId === targetUser.id;
      const rawSkills = await UserSkillModel.getUserSkills(targetUser.id);
      const summary = await UserSkillModel.getUserSkillSummary(targetUser.id);
      const classificationSummary = SkillCalculationService.buildSkillClassificationSummary(rawSkills);

      // Scoped output: If viewing another user's profile, return sanitized public skill metrics
      const skills = rawSkills.map((sk) => {
        if (isOwnProfile) {
          return sk;
        }
        return {
          topicKey: sk.topicKey,
          topicName: sk.topicName,
          category: sk.category,
          level: sk.level,
          classification: sk.classification,
          solvedCount: sk.solvedCount,
          confidence: sk.confidence,
          lastSolvedAt: sk.lastSolvedAt,
        };
      });

      res.status(200).json({
        success: true,
        userId: targetUser.id,
        username: targetUser.username,
        isOwnProfile,
        count: skills.length,
        summary: isOwnProfile ? summary : {
          totalTopicsTracked: summary.totalTopicsTracked,
          totalSolvedAcrossTopics: summary.totalSolvedAcrossTopics,
          strengthsCount: summary.strengthsCount,
          needsPracticeCount: summary.needsPracticeCount,
          developingCount: summary.developingCount,
          stableCount: summary.stableCount,
          unassessedCount: summary.unassessedCount,
        },
        classificationSummary: isOwnProfile ? classificationSummary : {
          strengthsCount: classificationSummary.strengthsCount,
          needsPracticeCount: classificationSummary.needsPracticeCount,
          developingCount: classificationSummary.developingCount,
          stableCount: classificationSummary.stableCount,
          unassessedCount: classificationSummary.unassessedCount,
        },
        skills,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/skills/user/:idOrUsername/history
   * Public / Protected: Retrieve progress history for a user (scoped by ownership privacy)
   */
  static async getUserSkillHistory(req, res, next) {
    try {
      const { idOrUsername } = req.params;
      const currentUserId = req.user ? req.user.id : null;
      const { topicKey, limit, offset, startDate, endDate, order } = req.query;

      let targetUser = null;
      if (/^\d+$/.test(idOrUsername)) {
        targetUser = await UserModel.findUserById(parseInt(idOrUsername, 10));
      } else {
        targetUser = await UserModel.findUserByUsername(idOrUsername);
      }

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: `User '${idOrUsername}' not found`,
        });
      }

      const isOwnProfile = currentUserId === targetUser.id;

      let resolvedTopicId = null;
      if (topicKey) {
        const topic = await TopicModel.getTopicByKey(topicKey);
        if (topic) {
          resolvedTopicId = topic.id;
        }
      }

      const rawHistory = await UserSkillHistoryModel.getHistory({
        userId: targetUser.id,
        topicId: resolvedTopicId,
        limit,
        offset,
        startDate,
        endDate,
        order,
      });

      const trends = await UserSkillHistoryModel.getUserOverallTrends(targetUser.id);

      // Scoped output: If viewing another user's profile, return sanitized public history
      const history = rawHistory.map((h) => {
        if (isOwnProfile) {
          return h;
        }
        return {
          topicKey: h.topicKey,
          topicName: h.topicName,
          topicCategory: h.topicCategory,
          level: h.level,
          classification: h.classification,
          confidence: h.confidence,
          solvedCount: h.solvedCount,
          recordedAt: h.recordedAt,
        };
      });

      res.status(200).json({
        success: true,
        userId: targetUser.id,
        username: targetUser.username,
        isOwnProfile,
        count: history.length,
        trends: isOwnProfile ? trends : {
          overallDirection: trends.overallDirection,
          totalTopicsTracked: trends.totalTopicsTracked,
        },
        history,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = SkillController;
