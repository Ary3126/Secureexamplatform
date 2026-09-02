const { query } = require('./src/config/db');

async function runMigration() {
  console.log('[MIGRATION] Running Phase 4A Extra Feature database migrations...');
  try {
    // 1. Users Table Enhancements (Bio, Avatar)
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
    `);
    console.log('[MIGRATION] users table updated with bio and avatar_url.');

    // 2. Problems Table Enhancements (Coding Mode, Starter Templates, Harness Templates)
    await query(`
      ALTER TABLE problems 
      ADD COLUMN IF NOT EXISTS coding_mode VARCHAR(30) NOT NULL DEFAULT 'full_program',
      ADD COLUMN IF NOT EXISTS starter_templates JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS harness_templates JSONB DEFAULT '{}'::jsonb;
    `);
    console.log('[MIGRATION] problems table updated with coding_mode, starter_templates, and harness_templates.');

    // 3. Submissions Table Enhancements (Coding Mode)
    await query(`
      ALTER TABLE submissions 
      ADD COLUMN IF NOT EXISTS coding_mode VARCHAR(30) NOT NULL DEFAULT 'full_program';
    `);
    console.log('[MIGRATION] submissions table updated with coding_mode.');

    console.log('[MIGRATION] All Phase 4A Extra migrations completed successfully without data loss.');
    process.exit(0);
  } catch (err) {
    console.error('[MIGRATION ERROR]', err);
    process.exit(1);
  }
}

runMigration();