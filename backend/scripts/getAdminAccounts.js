const db = require('../src/config/db');
const { hashPassword } = require('../src/services/authService');

async function checkAdmins() {
  const users = await db.query(
    "SELECT id, username, email, role, full_name, is_active FROM users WHERE role IN ('super_admin', 'professor', 'contest_admin') ORDER BY id ASC;"
  );
  console.log('Existing Privileged Accounts:');
  console.table(users.rows);

  // Check if standard admin / professor exists, if not create or set known password
  let superAdmin = users.rows.find(u => u.role === 'super_admin');
  let professor = users.rows.find(u => u.role === 'professor');

  // Let's ensure admin@securejudge.com / admin123 (or admin / admin123) and prof@securejudge.com / prof123 exist
  const adminHash = await hashPassword('Admin123!');
  const profHash = await hashPassword('Prof123!');

  if (!superAdmin) {
    const res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active) 
       VALUES ('admin', 'admin@securejudge.com', $1, 'super_admin', 'Super Administrator', true) 
       RETURNING id, username, email, role;`,
      [adminHash]
    );
    console.log('Created Super Admin:', res.rows[0]);
  } else {
    // Reset standard password for the super admin
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2;", [adminHash, superAdmin.id]);
    console.log(`Updated password for Super Admin '${superAdmin.username}' (${superAdmin.email}) to: Admin123!`);
  }

  if (!professor) {
    const res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active) 
       VALUES ('professor', 'prof@securejudge.com', $1, 'professor', 'Dr. Professor', true) 
       RETURNING id, username, email, role;`,
      [profHash]
    );
    console.log('Created Professor:', res.rows[0]);
  } else {
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2;", [profHash, professor.id]);
    console.log(`Updated password for Professor '${professor.username}' (${professor.email}) to: Prof123!`);
  }

  await db.closePool();
}

checkAdmins().catch(err => {
  console.error(err);
  process.exit(1);
});
