const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'secure_exam_db',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default_jwt_secret_change_me',
  },
  useDocker: process.env.USE_DOCKER === 'true',
  dockerJudgeImage: process.env.DOCKER_JUDGE_IMAGE || 'secure-judge:latest',
};

// Validate critical configurations
const validateEnv = () => {
  const missing = [];
  if (!process.env.DB_NAME && !config.db.name) missing.push('DB_NAME');
  if (!process.env.DB_USER && !config.db.user) missing.push('DB_USER');

  if (missing.length > 0) {
    console.warn(`[CONFIG WARNING] The following environment variables are missing: ${missing.join(', ')}`);
  }
};

validateEnv();

module.exports = config;