const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

/**
 * @route GET /api/admin/test
 * RBAC verification endpoint for Super Admin
 */
router.get('/admin/test', authenticate, authorizeRoles('super_admin'), (req, res) => {
  res.status(200).json({
    message: 'Welcome Super Admin. Access granted to admin endpoint.',
    user: req.user,
  });
});

/**
 * @route GET /api/professor/test
 * RBAC verification endpoint for Professor
 */
router.get('/professor/test', authenticate, authorizeRoles('professor'), (req, res) => {
  res.status(200).json({
    message: 'Welcome Professor. Access granted to professor endpoint.',
    user: req.user,
  });
});

/**
 * @route GET /api/contest-admin/test
 * RBAC verification endpoint for Contest Admin
 */
router.get('/contest-admin/test', authenticate, authorizeRoles('contest_admin'), (req, res) => {
  res.status(200).json({
    message: 'Welcome Contest Admin. Access granted to contest-admin endpoint.',
    user: req.user,
  });
});

module.exports = router;
