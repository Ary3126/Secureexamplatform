const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { validateUpdateProfile } = require('../middleware/validationMiddleware');
const { mediumProtectionRateLimiter } = require('../middleware/rateLimitMiddleware');

// Apply medium protection rate limiter to all user profile & identity queries
router.use(mediumProtectionRateLimiter);

/**
 * @route GET /api/users/me
 * Protected: Retrieve authenticated user profile with statistics
 */
router.get('/me', authenticate, userController.getProfile);

const SkillController = require('../controllers/skillController');

/**
 * @route GET /api/users/me/identity
 * Protected: Retrieve rich Coder Identity for authenticated user
 */
router.get('/me/identity', authenticate, userController.getCoderIdentity);

/**
 * @route GET /api/users/me/skills
 * Protected: Retrieve detailed skills breakdown for authenticated user
 */
router.get('/me/skills', authenticate, SkillController.getMySkills);

/**
 * @route GET /api/users/:idOrUsername/skills
 * Public / Protected: Retrieve scoped user skills
 */
router.get('/:idOrUsername/skills', optionalAuthenticate, SkillController.getUserSkills);

/**
 * @route PUT /api/users/me
 * Protected: Update authenticated user profile
 */
router.put('/me', authenticate, validateUpdateProfile, userController.updateProfile);

/**
 * @route GET /api/users/dashboard
 * Protected: Consolidated student dashboard data (running, upcoming, joined contests, solved, recent)
 */
router.get('/dashboard', authenticate, userController.getStudentDashboard);

/**
 * @route GET /api/users/:id/rating
 * Protected: Retrieve rating details for a user or ''me''
 */
router.get('/:id/rating', authenticate, userController.getUserRating);

/**
 * @route GET /api/users/:id/rating-history
 * Protected: Retrieve rating history for a user or ''me''
 */
router.get('/:id/rating-history', authenticate, userController.getUserRatingHistory);

/**
 * @route GET /api/users/u/:idOrUsername
 * @route GET /api/users/:idOrUsername/identity
 * Public / Protected: View comprehensive Coder Identity (public/private filtered)
 */
router.get('/u/:idOrUsername', optionalAuthenticate, userController.getCoderIdentity);
router.get('/:idOrUsername/identity', optionalAuthenticate, userController.getCoderIdentity);

/**
 * @route GET /api/users/:id/public-profile
 * Public / Protected: View public profile of any user
 */
router.get('/:id/public-profile', userController.getPublicProfile);
router.get('/profile/:id', userController.getPublicProfile);

module.exports = router;
