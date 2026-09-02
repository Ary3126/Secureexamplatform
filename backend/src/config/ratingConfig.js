/**
 * Centralized Configuration Constants for Competitive Rating System (Phase 5.4 & 5.6)
 */
const RATING_CONFIG = {
  // Initial starting rating for every new student
  INITIAL_RATING: 1200,

  // Number of rated contests required to transition from 'provisional' to 'rated'
  PROVISIONAL_CONTEST_THRESHOLD: 5,

  // Volatility K-Factor during provisional placement phase (faster calibration)
  PROVISIONAL_K_FACTOR: 64,

  // Volatility K-Factor for established rated participants
  RATED_K_FACTOR: 32,

  // Minimum floor rating (cannot drop below 100)
  MIN_RATING: 100,

  // Platform-Specific Competitive Rating Tiers
  TIERS: [
    {
      name: 'Elite',
      badge: 'ELITE',
      minRating: 2200,
      maxRating: Infinity,
      color: '#f43f5e',
      bg: 'rgba(244, 63, 94, 0.15)',
      description: 'Top-echelon competitive mastery',
    },
    {
      name: 'Master',
      badge: 'MASTER',
      minRating: 1900,
      maxRating: 2199,
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.15)',
      description: 'Advanced algorithmic problem solving prowess',
    },
    {
      name: 'Specialist',
      badge: 'SPECIALIST',
      minRating: 1600,
      maxRating: 1899,
      color: '#a855f7',
      bg: 'rgba(168, 85, 247, 0.15)',
      description: 'Solid competitive programming proficiency',
    },
    {
      name: 'Expert',
      badge: 'EXPERT',
      minRating: 1400,
      maxRating: 1599,
      color: '#3b82f6',
      bg: 'rgba(59, 130, 246, 0.15)',
      description: 'Consistent execution on intermediate challenges',
    },
    {
      name: 'Challenger',
      badge: 'CHALLENGER',
      minRating: 1200,
      maxRating: 1399,
      color: '#06b6d4',
      bg: 'rgba(6, 182, 212, 0.15)',
      description: 'Active contender developing core competencies',
    },
    {
      name: 'Explorer',
      badge: 'EXPLORER',
      minRating: 0,
      maxRating: 1199,
      color: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.15)',
      description: 'Beginning the competitive coding journey',
    },
  ],

  // Rating Distribution Histogram Buckets
  DISTRIBUTION_BUCKETS: [
    { label: '0–1199', tierName: 'Explorer', min: 0, max: 1199, color: '#94a3b8' },
    { label: '1200–1399', tierName: 'Challenger', min: 1200, max: 1399, color: '#06b6d4' },
    { label: '1400–1599', tierName: 'Expert', min: 1400, max: 1599, color: '#3b82f6' },
    { label: '1600–1899', tierName: 'Specialist', min: 1600, max: 1899, color: '#a855f7' },
    { label: '1900–2199', tierName: 'Master', min: 1900, max: 2199, color: '#f59e0b' },
    { label: '2200+', tierName: 'Elite', min: 2200, max: 99999, color: '#f43f5e' },
  ],

  /**
   * Helper to resolve tier details for a given rating score
   * @param {number} rating
   * @returns {Object} Tier configuration
   */
  getTierForRating(rating) {
    const r = typeof rating === 'number' && !isNaN(rating) ? rating : this.INITIAL_RATING;
    for (const tier of this.TIERS) {
      if (r >= tier.minRating) {
        return tier;
      }
    }
    return this.TIERS[this.TIERS.length - 1];
  },
};

module.exports = RATING_CONFIG;
