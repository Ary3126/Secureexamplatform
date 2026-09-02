const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validateRegister, validateLogin } = require('../middleware/validationMiddleware');
const { authRateLimiter } = require('../middleware/rateLimitMiddleware');

/**
 * @route POST /api/auth/register
 * @route POST /api/auth/signup
 * Public registration (protected with authRateLimiter)
 */
router.post('/register', authRateLimiter, validateRegister, authController.register);
router.post('/signup', authRateLimiter, validateRegister, authController.register);

/**
 * @route POST /api/auth/login
 * Public authentication (protected with authRateLimiter against brute-force/stuffing)
 */
router.post('/login', authRateLimiter, validateLogin, authController.login);

module.exports = router;
