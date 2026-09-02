const { query } = require('./src/config/db');

async function autoJoin() {
  try {
    const contests = (await query("SELECT id FROM contests WHERE status = 'published'")).rows;
    const users = (await query("SELECT id FROM users WHERE role = 'student'")).rows;

    for (const c of contests) {
      for (const u of users) {
        await query(
          "INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [c.id, u.id]
        );
      }
    }
    console.log(`Enrolled all ${users.length} students into ${contests.length} published contests.`);
    process.exit(0);
  } catch (err) {
    console.error('Auto join error:', err);
    process.exit(1);
  }
}

autoJoin();