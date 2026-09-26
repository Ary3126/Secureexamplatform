const db = require('../src/config/db');
const { hashPassword } = require('../src/services/authService');

async function resetAdmin() {
  try {
    const password = process.argv[2] || 'Admin@1234';
    const email = 'admin@securejudge.io';
    const pwHash = await hashPassword(password);

    const res = await db.query(
      `UPDATE users SET password_hash = $1, is_active = true, role = 'super_admin' WHERE email = $2 RETURNING id, username, email, role;`,
      [pwHash, email]
    );

    if (res.rowCount > 0) {
      console.log('SUCCESS: Admin password updated successfully!');
      console.log(res.rows[0]);
      console.log('Password set to:', password);
    } else {
      console.log('Admin user not found, creating new super_admin...');
      const createRes = await db.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
         VALUES ('platform_admin', $1, $2, 'Platform Administrator', 'super_admin', true)
         RETURNING id, username, email, role;`,
        [email, pwHash]
      );
      console.log('SUCCESS: Admin created!');
      console.log(createRes.rows[0]);
      console.log('Password set to:', password);
    }
  } catch (err) {
    console.error('Failed to update admin password:', err);
  } finally {
    await db.closePool();
  }
}

resetAdmin();
