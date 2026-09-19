const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '24h';

/**
 * Hash a plain text password using bcrypt
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
const hashPassword = async (plainPassword) => {
  return await bcrypt.hash(plainPassword, SALT_ROUNDS);
};

/**
 * Compare plain text password against bcrypt hash
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
const comparePassword = async (plainPassword, hash) => {
  return await bcrypt.compare(plainPassword, hash);
};

/**
 * Generate a JWT token containing user identity and role
 * @param {Object} user - User record { id, role }
 * @returns {string} Signed JWT token
 */
const generateToken = (user) => {
  const payload = {
    userId: user.id,
    role: user.role,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: TOKEN_EXPIRY,
    issuer: 'secure-exam-platform',
  });
};

/**
 * Verify and decode a JWT token
 * @param {string} token
 * @returns {Object} Decoded payload
 */
const verifyToken = (token) => {
  return jwt.verify(token, config.jwt.secret, {
    issuer: 'secure-exam-platform',
  });
};

/**
 * Sanitize a user object by removing sensitive fields (password_hash)
 * @param {Object} user
 * @returns {Object} Sanitized user
 */
const sanitizeUser = (user) => {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name || user.fullName,
    role: user.role,
    bio: user.bio || '',
    avatarUrl: user.avatar_url || user.avatarUrl || '',
    institution: user.institution || '',
    currentRating: user.current_rating !== undefined ? user.current_rating : (user.currentRating !== undefined ? user.currentRating : 1200),
    highestRating: user.highest_rating !== undefined ? user.highest_rating : (user.highestRating !== undefined ? user.highestRating : 1200),
    ratingStatus: user.rating_status || user.ratingStatus || 'provisional',
    ratedContestCount: user.rated_contest_count !== undefined ? user.rated_contest_count : (user.ratedContestCount !== undefined ? user.ratedContestCount : 0),
    isActive: user.is_active !== undefined ? user.is_active : (user.isActive !== undefined ? user.isActive : true),
    createdAt: user.created_at || user.createdAt,
  };
};

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  sanitizeUser,
};