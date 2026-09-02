const express = require('express');
const router = express.Router();
const SkillController = require('../controllers/skillController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { mediumProtectionRateLimiter } = require('../middleware/rateLimitMiddleware');

// Apply rate limiting across skill query endpoints
router.use(mediumProtectionRateLimiter);

/**
 * @route GET /api/skills/topics
 * Public / Protected: List all supported algorithmic topics
 */
router.get('/topics', SkillController.getTopics);

/**
 * @route GET /api/skills/my/history/:topicKey
 * Protected: Retrieve authenticated user's progress history and trend for a specific topic
 */
router.get('/my/history/:topicKey', authenticate, SkillController.getMyTopicHistory);

/**
 * @route GET /api/skills/my/history
 * Protected: Retrieve authenticated user's progress history across topics
 */
router.get('/my/history', authenticate, SkillController.getMySkillHistory);

/**
 * @route GET /api/skills/my
 * Protected: Retrieve authenticated user's detailed skills
 */
router.get('/my', authenticate, SkillController.getMySkills);

/**
 * @route GET /api/skills/user/:idOrUsername/history
 * Public / Optional Authenticated: Scoped user skill history view with privacy isolation
 */
router.get('/user/:idOrUsername/history', optionalAuthenticate, SkillController.getUserSkillHistory);

/**
 * @route GET /api/skills/user/:idOrUsername
 * Public / Optional Authenticated: Scoped user skills view with privacy isolation
 */
router.get('/user/:idOrUsername', optionalAuthenticate, SkillController.getUserSkills);

module.exports = router;
