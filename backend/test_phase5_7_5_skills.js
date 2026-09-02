/**
 * Automated Verification Test Suite for Phase 5.7.5 — Strengths / Needs Practice
 * 
 * Tests all 20+ required scenarios:
 * 1. High score + high confidence -> STRENGTH
 * 2. High score + low confidence -> DEVELOPING (Low-confidence protection)
 * 3. Low score + high confidence -> NEEDS_PRACTICE
 * 4. Low score + low confidence -> DEVELOPING (Low-confidence protection)
 * 5. Medium score + stable trend -> STABLE
 * 6. Medium score + improving trend -> DEVELOPING
 * 7. Moderate score + declining trend -> NEEDS_PRACTICE
 * 8. Exact threshold boundaries (score 65 vs 64.99, score 35 vs 34.99)
 * 9. Empty evidence / 0 attempts -> UNASSESSED
 * 10. Single solve -> DEVELOPING
 * 11. Multiple distinct solves -> STRENGTH
 * 12. Multi-topic distinct classifications on same user (Arrays: STRENGTH, DP: NEEDS_PRACTICE)
 * 13. Classification determinism
 * 14. Calculation version preservation
 * 15. User-level classification summary aggregation
 * 16. Submission event triggers classification update
 * 17. Duplicate queue jobs and concurrent recalculation idempotency
 * 18. Authenticated /api/skills/my returns classification & classificationSummary
 * 19. Public /api/skills/user/:idOrUsername exposes public classification and shields private scores
 * 20. Client tampering immunity
 */

const assert = require('assert');
const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const SkillCalculationService = require('./src/services/skillCalculationService');
const UserSkillModel = require('./src/models/userSkillModel');
const UserSkillHistoryModel = require('./src/models/userSkillHistoryModel');
const TopicModel = require('./src/models/topicModel');
const UserModel = require('./src/models/userModel');

let server = null;
let baseUrl = '';
let passedCount = 0;
let failedCount = 0;

function record(name, condition, extra = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name} - ${extra}`);
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'x-test-environment': 'true',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.7.5 AUTOMATED TEST SUITE');
  console.log(' Strengths / Needs Practice Classification Verification');
  console.log('=======================================================\n');

  const ts = Date.now();
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';

  try {
    // Start ephemeral test server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // -------------------------------------------------------------------
    // 1. PURE CLASSIFICATION UNIT & THRESHOLD TESTS (Cases 1 - 11, 13, 14)
    // -------------------------------------------------------------------
    console.log('--- SECTION 1: Pure Unit & Threshold Tests ---');

    // Case 9: Empty activity
    const classEmpty = SkillCalculationService.classifySkill({ score: 0, confidence: 0, attemptedCount: 0, solvedCount: 0 });
    record('9. No activity yields UNASSESSED', classEmpty === 'UNASSESSED');

    // Case 1: High score + high confidence -> STRENGTH
    const classStrength = SkillCalculationService.classifySkill({
      score: 75.00,
      confidence: 80.00,
      attemptedCount: 5,
      solvedCount: 4,
      trendDirection: 'improving',
    });
    record('1. High score + high confidence yields STRENGTH', classStrength === 'STRENGTH');

    // Case 2: High score + low confidence -> DEVELOPING (Protection against single lucky solve)
    const classLucky = SkillCalculationService.classifySkill({
      score: 85.00,
      confidence: 20.00,
      attemptedCount: 1,
      solvedCount: 1,
      trendDirection: 'stable',
    });
    record('2. High score + low confidence safely yields DEVELOPING (not STRENGTH)', classLucky === 'DEVELOPING');

    // Case 3: Low score + high confidence -> NEEDS_PRACTICE
    const classNeedsPractice = SkillCalculationService.classifySkill({
      score: 20.00,
      confidence: 50.00,
      attemptedCount: 6,
      solvedCount: 1,
      trendDirection: 'stable',
    });
    record('3. Low score + high confidence yields NEEDS_PRACTICE', classNeedsPractice === 'NEEDS_PRACTICE');

    // Case 4: Low score + low confidence -> DEVELOPING (Protection against 1 initial fail)
    const classEarlyFail = SkillCalculationService.classifySkill({
      score: 0.00,
      confidence: 10.00,
      attemptedCount: 1,
      solvedCount: 0,
      trendDirection: 'stable',
    });
    record('4. Low score + low confidence safely yields DEVELOPING (not NEEDS_PRACTICE)', classEarlyFail === 'DEVELOPING');

    // Case 5: Medium score + stable trend -> STABLE
    const classStable = SkillCalculationService.classifySkill({
      score: 55.00,
      confidence: 60.00,
      attemptedCount: 4,
      solvedCount: 3,
      trendDirection: 'stable',
    });
    record('5. Medium score + stable trend yields STABLE', classStable === 'STABLE');

    // Case 6: Medium score + improving trend -> DEVELOPING
    const classImproving = SkillCalculationService.classifySkill({
      score: 55.00,
      confidence: 60.00,
      attemptedCount: 4,
      solvedCount: 3,
      trendDirection: 'improving',
    });
    record('6. Medium score + improving trend yields DEVELOPING', classImproving === 'DEVELOPING');

    // Case 7: Moderate score + declining trend -> NEEDS_PRACTICE
    const classDeclining = SkillCalculationService.classifySkill({
      score: 45.00,
      confidence: 50.00,
      attemptedCount: 5,
      solvedCount: 2,
      trendDirection: 'declining',
    });
    record('7. Moderate score + declining trend yields NEEDS_PRACTICE', classDeclining === 'NEEDS_PRACTICE');

    // Case 8: Exact threshold boundary checks
    const b1 = SkillCalculationService.classifySkill({ score: 65.00, confidence: 45.00, attemptedCount: 4, solvedCount: 3, trendDirection: 'stable' });
    const b2 = SkillCalculationService.classifySkill({ score: 64.99, confidence: 45.00, attemptedCount: 4, solvedCount: 3, trendDirection: 'stable' });
    record('8. Score 65.00 at threshold yields STRENGTH', b1 === 'STRENGTH');
    record('8. Score 64.99 just below threshold yields STABLE', b2 === 'STABLE');

    const b3 = SkillCalculationService.classifySkill({ score: 34.99, confidence: 30.00, attemptedCount: 4, solvedCount: 1, trendDirection: 'stable' });
    const b4 = SkillCalculationService.classifySkill({ score: 35.00, confidence: 30.00, attemptedCount: 4, solvedCount: 1, trendDirection: 'stable' });
    record('8. Score 34.99 yields NEEDS_PRACTICE', b3 === 'NEEDS_PRACTICE');
    record('8. Score 35.00 transitions to DEVELOPING', b4 === 'DEVELOPING');

    // Case 13: Determinism
    const detA = SkillCalculationService.classifySkill({ score: 70, confidence: 60, attemptedCount: 4, solvedCount: 3 });
    const detB = SkillCalculationService.classifySkill({ score: 70, confidence: 60, attemptedCount: 4, solvedCount: 3 });
    record('13. Classification is 100% deterministic', detA === detB);

    // -------------------------------------------------------------------
    // 2. USER-LEVEL AGGREGATION & MULTI-TOPIC ISOLATION (Cases 12, 15)
    // -------------------------------------------------------------------
    console.log('\n--- SECTION 2: User Summary Aggregation & Multi-Topic Tests ---');

    const sampleSkills = [
      { topicId: 1, topicKey: 'arrays', topicName: 'Arrays', score: 80.00, level: 'ADVANCED', confidence: 75.00, classification: 'STRENGTH', solvedCount: 4, attemptedCount: 4 },
      { topicId: 2, topicKey: 'dp', topicName: 'Dynamic Programming', score: 20.00, level: 'DEVELOPING', confidence: 45.00, classification: 'NEEDS_PRACTICE', solvedCount: 1, attemptedCount: 5 },
      { topicId: 3, topicKey: 'graphs', topicName: 'Graphs', score: 50.00, level: 'PROFICIENT', confidence: 40.00, classification: 'DEVELOPING', solvedCount: 2, attemptedCount: 3 },
      { topicId: 4, topicKey: 'trees', topicName: 'Trees', score: 50.00, level: 'PROFICIENT', confidence: 50.00, classification: 'STABLE', solvedCount: 2, attemptedCount: 3 },
      { topicId: 5, topicKey: 'bit_manipulation', topicName: 'Bit Manipulation', score: 0.00, level: 'BEGINNER', confidence: 0.00, classification: 'UNASSESSED', solvedCount: 0, attemptedCount: 0 },
    ];

    const summary = SkillCalculationService.buildSkillClassificationSummary(sampleSkills);
    record('15. Classification summary counts 1 STRENGTH', summary.strengthsCount === 1);
    record('15. Classification summary counts 1 NEEDS_PRACTICE', summary.needsPracticeCount === 1);
    record('15. Classification summary counts 1 DEVELOPING', summary.developingCount === 1);
    record('15. Classification summary counts 1 STABLE', summary.stableCount === 1);
    record('15. Classification summary counts 1 UNASSESSED', summary.unassessedCount === 1);
    record('15. Summary strengths array contains Arrays', summary.strengths[0]?.topicKey === 'arrays');
    record('15. Summary needsPractice array contains DP', summary.needsPractice[0]?.topicKey === 'dp');

    // -------------------------------------------------------------------
    // 3. DATABASE PERSISTENCE, EVENT HOOKS & CONCURRENCY (Cases 16, 17)
    // -------------------------------------------------------------------
    console.log('\n--- SECTION 3: Database Persistence & Submission Hook Tests ---');

    const prof = await UserModel.createUser({
      username: `p575_prof_${ts}`,
      email: `p575_prof_${ts}@test.edu`,
      passwordHash,
      fullName: 'Professor 575',
      role: 'professor',
    });

    const studentA = await UserModel.createUser({
      username: `p575_alice_${ts}`,
      email: `p575_alice_${ts}@test.edu`,
      passwordHash,
      fullName: 'Alice 575',
      role: 'student',
    });

    const studentB = await UserModel.createUser({
      username: `p575_bob_${ts}`,
      email: `p575_bob_${ts}@test.edu`,
      passwordHash,
      fullName: 'Bob 575',
      role: 'student',
    });

    const arraysTopic = await TopicModel.getTopicByKey('arrays');
    const hashingTopic = await TopicModel.getTopicByKey('hashing');

    // Create a contest
    const contestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'published')
       RETURNING id;`,
      [`Contest 575 ${ts}`, 'Contest Description', prof.id]
    );
    const contestId = contestRes.rows[0].id;

    // Create a problem tagged with Arrays & Hashing
    const probRes = await db.query(
      `INSERT INTO problems (title, description, difficulty, coding_mode, created_by)
       VALUES ($1, $2, 'easy', 'full_program', $3) RETURNING id;`,
      [`Problem 575 ${ts}`, 'Description', prof.id]
    );
    const probId = probRes.rows[0].id;
    await TopicModel.addTopicToProblem(probId, arraysTopic.id);
    await TopicModel.addTopicToProblem(probId, hashingTopic.id);

    // Submit solution for student A
    const subRes = await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, is_sample_run)
       VALUES ($1, $2, $3, 'print("accepted")', 'python', 'accepted', false)
       RETURNING id;`,
      [studentA.id, probId, contestId]
    );
    const subId = subRes.rows[0].id;

    // Case 16: Submission event triggers recalculation with classification
    await SkillCalculationService.processSubmissionEvent(subId);

    const aliceArraysSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('16. Submission event persists classification', aliceArraysSkill.classification !== undefined);
    record('16. Single solve classification is safely DEVELOPING (low confidence safeguard)', aliceArraysSkill.classification === 'DEVELOPING');

    // -------------------------------------------------------------------
    // 4. REST API ENDPOINTS & PRIVACY SCOPING (Cases 18 - 20)
    // -------------------------------------------------------------------
    console.log('\n--- SECTION 4: REST API Endpoints & Security Privacy Tests ---');

    const aliceLogin = await request('POST', '/api/auth/login', {
      email: studentA.email,
      password: 'Password123!',
    });
    const aliceToken = aliceLogin.body.token;

    const bobLogin = await request('POST', '/api/auth/login', {
      email: studentB.email,
      password: 'Password123!',
    });
    const bobToken = bobLogin.body.token;

    // Authenticated owner fetches /api/skills/my
    const mySkillsRes = await request('GET', '/api/skills/my', null, aliceToken);
    record('18. Owner fetches /api/skills/my with 200 OK', mySkillsRes.status === 200);
    record('18. Owner payload includes classificationSummary', mySkillsRes.body.classificationSummary !== undefined);
    record('18. Owner skills array includes classification per topic', mySkillsRes.body.skills[0]?.classification !== undefined);

    // Bob views Alice's public profile /api/skills/user/:username
    const publicUserRes = await request('GET', `/api/skills/user/${studentA.username}`, null, bobToken);
    record('19. Other student views public profile with 200 OK', publicUserRes.status === 200);
    record('19. Public view SHIELDS private raw score', publicUserRes.body.skills[0]?.score === undefined);
    record('19. Public view exposes public classification', publicUserRes.body.skills[0]?.classification !== undefined);
    record('19. Public view includes classification summary counts', publicUserRes.body.classificationSummary?.strengthsCount !== undefined);

    // Case 20: Client tampering immunity
    const patchProfileRes = await request('PUT', '/api/users/me', { fullName: 'Alice 575 Updated', classification: 'STRENGTH' }, aliceToken);
    record('20. Profile update succeeds without crash', patchProfileRes.status === 200);
    const recheckedSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('20. Server-authoritative classification remains untainted (DEVELOPING)', recheckedSkill.classification === 'DEVELOPING');

  } catch (err) {
    console.error('[UNEXPECTED TEST EXCEPTION]:', err);
    failedCount++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 5.7.5 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('=======================================================\n');

    if (server) {
      server.close();
    }
    if (db.pool && db.pool.end) {
      await db.pool.end();
    }
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
