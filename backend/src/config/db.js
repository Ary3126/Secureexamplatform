const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  max: 20, // Max number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 3000, // Return an error after 3 seconds if connection cannot be established
});

// Pool error handling for idle clients
pool.on('error', (err) => {
  console.error('[DATABASE POOL ERROR] Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Execute parameterized queries safely
 * @param {string} text - SQL query text with parameter placeholders ($1, $2, etc.)
 * @param {Array} params - Array of parameter values
 */
const query = (text, params) => pool.query(text, params);

/**
 * Test PostgreSQL database connectivity
 * @returns {Promise<{ isConnected: boolean, error?: string }>}
 */
const testConnection = async () => {
  try {
    const res = await pool.query('SELECT 1 AS health_check');
    if (res && res.rows && res.rows[0].health_check === 1) {
      return { isConnected: true };
    }
    return { isConnected: false, error: 'Invalid response from database' };
  } catch (error) {
    // Return sanitized error indicator without exposing raw credentials
    return { isConnected: false, error: error.message };
  }
};

/**
 * Gracefully close the database pool
 */
const closePool = async () => {
  try {
    await pool.end();
    console.log('[DATABASE] PostgreSQL pool has been closed gracefully.');
  } catch (err) {
    console.error('[DATABASE] Error closing PostgreSQL pool:', err.message);
  }
};

/**
 * Acquire a dedicated PostgreSQL client from the pool for transactions
 */
const getClient = () => pool.connect();

module.exports = {
  pool,
  query,
  getClient,
  testConnection,
  closePool,
};
