const db = require('../src/config/db');

async function runAudit() {
  console.log('=== DATABASE INVENTORY AUDIT ===');
  
  const tables = await db.query(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
  `);
  console.log('\n1. Registered Database Tables (' + tables.rows.length + '):');
  console.log(tables.rows.map(r => r.table_name).join(', '));

  const uCount = await db.query('SELECT role, count(*), count(*) FILTER (WHERE is_active = true) as active FROM users GROUP BY role;');
  console.log('\n2. User Accounts Breakdown:');
  console.table(uCount.rows);

  const pCount = await db.query('SELECT review_status, is_published, count(*) FROM problems GROUP BY review_status, is_published;');
  console.log('\n3. Problem Bank Breakdown:');
  console.table(pCount.rows);

  const problemsList = await db.query('SELECT id, title, version, review_status, is_published, access_scope, created_by FROM problems ORDER BY id ASC;');
  console.log('\n4. Active Problems in Database:');
  console.table(problemsList.rows);

  const cCount = await db.query('SELECT id, title, status, created_by FROM contests ORDER BY id ASC;');
  console.log('\n5. Active Contests in Database:');
  console.table(cCount.rows);

  const auditCount = await db.query('SELECT count(*) FROM audit_logs;');
  console.log('\n6. Persistent Audit Log Count: ' + auditCount.rows[0].count);

  const recentAudit = await db.query('SELECT id, action, actor_id, outcome, resource_type, resource_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 5;');
  console.log('\n7. Most Recent 5 Audit Log Entries:');
  console.table(recentAudit.rows);

  await db.closePool();
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
