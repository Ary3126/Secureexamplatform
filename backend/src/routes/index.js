const express = require('express');
const router = express.Router();
const healthRoutes = require('./healthRoutes');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const contestRoutes = require('./contestRoutes');
const problemRoutes = require('./problemRoutes');
const testCaseRoutes = require('./testCaseRoutes');
const submissionRoutes = require('./submissionRoutes');
const leaderboardRoutes = require('./leaderboardRoutes');
const skillRoutes = require('./skillRoutes');
const adminRoutes = require('./adminRoutes');
const rbacTestRoutes = require('./rbacTestRoutes');

// Mount routes under /api
router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);
router.use('/contests', contestRoutes);
router.use('/problems', problemRoutes);
router.use('/', testCaseRoutes);
router.use('/submissions', submissionRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/skills', skillRoutes);
router.use('/', rbacTestRoutes);

module.exports = router;