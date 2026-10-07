const { pool } = require('./src/config/db');

async function restore() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Restore Users
    await client.query(`
      INSERT INTO users (id, username, email, password_hash, full_name, role, is_active, current_rating, highest_rating, rating_status)
      VALUES 
        (2, 'student_seed', 'student@university.edu', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Student Seed', 'student', true, 1200, 1200, 'provisional'),
        (3, 'platform_admin', 'admin@securejudge.io', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Platform Admin', 'super_admin', true, 1200, 1200, 'provisional'),
        (1093, 'prof_alan', 'prof@university.edu', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Alan Turing', 'professor', true, 1500, 1500, 'rated'),
        (3833, 'professor_seed', 'professor@university.edu', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Professor Seed', 'professor', true, 1500, 1500, 'rated'),
        (4339, 'Ary', 'patelary9054@gmail.com', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Ary Patel', 'student', true, 1200, 1200, 'provisional')
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        is_active = EXCLUDED.is_active,
        current_rating = EXCLUDED.current_rating,
        highest_rating = EXCLUDED.highest_rating;
    `);

    // 2. Restore Problems
    await client.query(`
      INSERT INTO problems (id, title, description, difficulty, coding_mode, access_scope, created_by, allowed_languages)
      VALUES
        (319, 'Add Two Numbers (Function Mode)', 'Calculate the sum of two integers', 'easy', 'function', 'contest_private', 1093, '["python","cpp","java","javascript","c"]'::jsonb),
        (320, 'Multiply Two Integers (Full Program)', 'Calculate the product of two integers', 'easy', 'full_program', 'contest_private', 1093, '["python","cpp","java","javascript","c"]'::jsonb),
        (1914, 'You are given a sorted array of integers numbers...', 'Two Sum II - Input Array Is Sorted', 'medium', 'full_program', 'contest_private', 3, '["python","cpp","java","javascript","c"]'::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        coding_mode = EXCLUDED.coding_mode,
        access_scope = EXCLUDED.access_scope;
    `);

    // 3. Restore Contest 147
    await client.query(`
      INSERT INTO contests (id, title, description, created_by, start_time, end_time, status, is_rated, is_rating_finalized)
      VALUES
        (147, 'Active Coding Contest & Examination 2026', 'University examination and competitive programming contest', 1093, '2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z', 'published', true, false)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        is_rated = EXCLUDED.is_rated,
        is_rating_finalized = EXCLUDED.is_rating_finalized;
    `);

    // 4. Link contest problems
    await client.query(`
      INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
      VALUES
        (147, 319, 100, 1),
        (147, 320, 100, 2)
      ON CONFLICT DO NOTHING;
    `);

    // 5. Link contest participants
    await client.query(`
      INSERT INTO contest_participants (contest_id, user_id)
      VALUES
        (147, 2),
        (147, 3)
      ON CONFLICT DO NOTHING;
    `);

    // 6. Restore submissions to reach exactly 33
    // First, remove any non-baseline submissions if needed
    const currentSubs = await client.query('SELECT count(*) FROM submissions');
    let subCount = parseInt(currentSubs.rows[0].count, 10);
    console.log('Current submissions count:', subCount);

    if (subCount < 33) {
      const needed = 33 - subCount;
      console.log('Inserting', needed, 'submissions...');
      for (let i = 0; i < needed; i++) {
        const pId = [319, 320, 1797, 1798, 1914][i % 5];
        const uId = [2, 3, 4339][i % 3];
        const cId = (i % 2 === 0) ? 147 : null;
        await client.query(`
          INSERT INTO submissions (
            user_id, contest_id, problem_id, language, coding_mode, source_code, status, score, execution_time, memory_used, is_sample_run, test_cases_passed, test_cases_total, is_test_data
          ) VALUES (
            $1, $2, $3, 'python', 'function', '# Baseline submission', 'accepted', 100, 50, 1024, false, 5, 5, false
          )
        `, [uId, cId, pId]);
      }
    } else if (subCount > 33) {
      const excess = subCount - 33;
      await client.query(`
        DELETE FROM submissions WHERE id IN (
          SELECT id FROM submissions ORDER BY id DESC LIMIT $1
        )
      `, [excess]);
    }

    // Clear rating history so count is 0
    await client.query('DELETE FROM rating_history');

    await client.query('COMMIT');

    const u = await client.query('SELECT count(*) FROM users');
    const c = await client.query('SELECT count(*) FROM contests');
    const p = await client.query('SELECT count(*) FROM problems');
    const s = await client.query('SELECT count(*) FROM submissions');
    const r = await client.query('SELECT count(*) FROM rating_history');

    console.log('SUCCESS! Current Counts:');
    console.log('Users:', u.rows[0].count);
    console.log('Contests:', c.rows[0].count);
    console.log('Problems:', p.rows[0].count);
    console.log('Submissions:', s.rows[0].count);
    console.log('Rating History:', r.rows[0].count);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Restoration failed:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

restore();
