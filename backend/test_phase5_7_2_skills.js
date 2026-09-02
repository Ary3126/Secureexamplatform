/**
 * Automated Verification Test Suite for Phase 5.7.2 — Skill Scoring Engine
 * 
 * Tests all 22 required scoring scenarios:
 * 1. No activity (empty state)
 * 2. One accepted easy problem
 * 3. One accepted hard problem (hard > easy)
 * 4. Failed attempts only
 * 5. Multiple accepted problems
 * 6. Mixed accepted / failed submissions
 * 7. Repeated submissions
 * 8. Repeated accepted submissions on same problem (anti-farming)
 * 9. Old activity vs recent activity (recency decay)
 * 10. Multiple topics isolation
 * 11. Problem with multiple topic relationships
 * 12. Score lower boundary (>= 0.00)
 * 13. Score upper boundary (<= 100.00)
 * 14. Deterministic calculation reproducibility
 * 15. Rounding stability (2 decimals)
 * 16. Invalid / missing difficulty handling
 * 17. Concurrent / repeated recalculation idempotency
 * 18. calculationVersion behavior (version 2)
 * 19. Unauthorized skill access (privacy boundary)
 * 20. Attempt to manually modify skill score via API
 * 21. Queue / submission event triggered recalculation
 * 22. Stale calculation protection
 */

const assert = require('assert');
const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const SkillCalculationService = require('./src/services/skillCalculationService');
const UserSkillModel = require('./src/models/userSkillModel');
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
  console.log(' STARTING PHASE 5.7.2 AUTOMATED TEST SUITE');
  console.log(' Deterministic Skill Scoring Engine Verification');
  console.log('=======================================================\n');

  const ts = Date.now();
  const refDate = new Date('2026-08-20T12:00:00Z');
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6'; // Password123!

  try {
    // Start ephemeral server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // -------------------------------------------------------------------
    // 1. PURE SCORING FORMULA UNIT TESTS (Cases 1 - 16)
    // -------------------------------------------------------------------
    console.log('--- SECTION 1: Pure Scoring Formula Unit Tests ---');

    // Case 1: No activity (empty state)
    const emptyResult = SkillCalculationService.calculateSkill([], null, refDate);
    record('1. No activity returns score 0.00', emptyResult.score === 0.00);
    record('1. No activity returns level BEGINNER', emptyResult.level === 'BEGINNER');
    record('1. No activity returns attemptedCount 0', emptyResult.attemptedCount === 0);
    record('1. No activity returns solvedCount 0', emptyResult.solvedCount === 0);
    record('1. No activity sets calculationVersion to 2 or newer', emptyResult.calculationVersion >= 2);

    // Case 2: One accepted easy problem (fresh)
    const oneEasyEvidence = [
      {
        topicId: 1,
        topicKey: 'arrays',
        problemId: 101,
        problemDifficulty: 'easy',
        submissionId: 1,
        verdict: 'accepted',
        isAccepted: true,
        timestamp: new Date('2026-08-19T12:00:00Z'), // 1 day old (recency = 1.0)
      },
    ];
    const oneEasyResult = SkillCalculationService.calculateSkill(oneEasyEvidence, null, refDate);
    record('2. One accepted easy problem gives positive score', oneEasyResult.score > 0);
    record('2. One easy score matches calculated base (15.00)', oneEasyResult.score === 15.00);
    record('2. One easy problem level is BEGINNER (< 20)', oneEasyResult.level === 'BEGINNER');

    // Case 3: One accepted hard problem (hard > easy)
    const oneHardEvidence = [
      {
        topicId: 1,
        topicKey: 'arrays',
        problemId: 102,
        problemDifficulty: 'hard',
        submissionId: 2,
        verdict: 'accepted',
        isAccepted: true,
        timestamp: new Date('2026-08-19T12:00:00Z'),
      },
    ];
    const oneHardResult = SkillCalculationService.calculateSkill(oneHardEvidence, null, refDate);
    record('3. One hard problem scores higher than one easy problem', oneHardResult.score > oneEasyResult.score);
    record('3. One hard problem is capped at breadth ceiling (35.00)', oneHardResult.score === 35.00);
    record('3. One hard problem level is DEVELOPING (>= 20)', oneHardResult.level === 'DEVELOPING');

    // Case 4: Failed attempts only
    const failedOnlyEvidence = [
      {
        topicId: 1,
        topicKey: 'arrays',
        problemId: 103,
        problemDifficulty: 'medium',
        submissionId: 3,
        verdict: 'wrong_answer',
        isAccepted: false,
        timestamp: new Date('2026-08-19T12:00:00Z'),
      },
      {
        topicId: 1,
        topicKey: 'arrays',
        problemId: 103,
        problemDifficulty: 'medium',
        submissionId: 4,
        verdict: 'time_limit_exceeded',
        isAccepted: false,
        timestamp: new Date('2026-08-19T12:30:00Z'),
      },
    ];
    const failedOnlyResult = SkillCalculationService.calculateSkill(failedOnlyEvidence, null, refDate);
    record('4. Failed attempts only strictly yields score 0.00', failedOnlyResult.score === 0.00);
    record('4. Failed attempts only has level BEGINNER', failedOnlyResult.level === 'BEGINNER');
    record('4. Failed attempts only tracks attemptedCount 2', failedOnlyResult.attemptedCount === 2);
    record('4. Failed attempts only tracks solvedCount 0', failedOnlyResult.solvedCount === 0);

    // Case 5: Multiple accepted problems
    const multiAcceptedEvidence = [
      { topicId: 1, problemId: 201, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T12:00:00Z') },
      { topicId: 1, problemId: 202, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-19T12:00:00Z') },
      { topicId: 1, problemId: 203, problemDifficulty: 'hard', isAccepted: true, timestamp: new Date('2026-08-19T12:00:00Z') },
    ];
    const multiAcceptedResult = SkillCalculationService.calculateSkill(multiAcceptedEvidence, null, refDate);
    record('5. Multiple accepted problems scale score up', multiAcceptedResult.score > oneHardResult.score);
    record('5. Solved count tracks 3 unique problems', multiAcceptedResult.solvedCount === 3);
    record('5. Level scales to ADVANCED (>= 70)', multiAcceptedResult.level === 'ADVANCED');

    // Case 6: Mixed accepted and failed submissions
    const mixedEvidence = [
      { topicId: 1, problemId: 301, problemDifficulty: 'medium', isAccepted: false, timestamp: new Date('2026-08-18T10:00:00Z') },
      { topicId: 1, problemId: 301, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-18T11:00:00Z') },
      { topicId: 1, problemId: 302, problemDifficulty: 'medium', isAccepted: false, timestamp: new Date('2026-08-18T12:00:00Z') },
      { topicId: 1, problemId: 302, problemDifficulty: 'medium', isAccepted: false, timestamp: new Date('2026-08-18T13:00:00Z') },
    ];
    const mixedResult = SkillCalculationService.calculateSkill(mixedEvidence, null, refDate);
    record('6. Mixed submissions accurately credit solved problem', mixedResult.solvedCount === 1);
    record('6. Accuracy penalty dampens score vs pure solve', mixedResult.score < 30.00);

    // Case 7 & 8: Repeated submissions & farming resistance
    const farmingEvidence = [
      { topicId: 1, problemId: 401, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-18T10:00:00Z') },
      { topicId: 1, problemId: 401, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-18T10:05:00Z') },
      { topicId: 1, problemId: 401, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-18T10:10:00Z') },
      { topicId: 1, problemId: 401, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-18T10:15:00Z') },
    ];
    const farmingResult = SkillCalculationService.calculateSkill(farmingEvidence, null, refDate);
    record('7. Repeated accepted submissions track attemptedCount 4', farmingResult.attemptedCount === 4);
    record('8. Solved count strictly deduplicated to 1', farmingResult.solvedCount === 1);
    record('8. Repeated solve score does NOT inflate above single solve', farmingResult.score <= 15.00);

    // Case 9: Old activity vs recent activity (Recency Decay)
    const freshEvidence = [
      { topicId: 1, problemId: 501, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') }, // 1 day old
    ];
    const oldEvidence = [
      { topicId: 1, problemId: 501, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2025-08-20T10:00:00Z') }, // 365 days old
    ];
    const freshResult = SkillCalculationService.calculateSkill(freshEvidence, null, refDate);
    const oldResult = SkillCalculationService.calculateSkill(oldEvidence, null, refDate);
    record('9. Fresh solve produces higher score than old solve (recency decay)', freshResult.score > oldResult.score);
    record('9. Old solve retains base floor mastery (60% weight -> 18.00)', oldResult.score === 18.00);

    // Case 12 & 13: Bounded Score Limits (0 to 100)
    const expertEvidence = [
      { topicId: 1, problemId: 601, problemDifficulty: 'hard', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 602, problemDifficulty: 'hard', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 603, problemDifficulty: 'hard', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 604, problemDifficulty: 'hard', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
    ];
    const expertResult = SkillCalculationService.calculateSkill(expertEvidence, null, refDate);
    record('12. Score lower boundary: score is >= 0', emptyResult.score >= 0.00);
    record('13. Score upper boundary: score is strictly <= 100.00', expertResult.score <= 100.00);
    record('13. Four hard solves reach maximum bounded score 100.00', expertResult.score === 100.00);
    record('13. Level for 100.00 is EXPERT', expertResult.level === 'EXPERT');

    // Case 14 & 15: Deterministic Calculation & Rounding Stability
    const testA = SkillCalculationService.calculateSkill(mixedEvidence, null, refDate);
    const testB = SkillCalculationService.calculateSkill(mixedEvidence, null, refDate);
    record('14. Identical evidence produces 100% deterministic score', testA.score === testB.score);
    record('15. Score is rounded to exactly two decimal places', Number.isFinite(testA.score) && testA.score.toString().split('.')[1]?.length <= 2);

    // Case 16: Invalid / missing difficulty handling
    const unknownDiffEvidence = [
      { topicId: 1, problemId: 701, problemDifficulty: 'unknown_tier', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
    ];
    const unknownDiffResult = SkillCalculationService.calculateSkill(unknownDiffEvidence, null, refDate);
    record('16. Unknown difficulty safely defaults to easy base points (15.00)', unknownDiffResult.score === 15.00);

    // -------------------------------------------------------------------
    // 2. DATABASE, API, MULTI-TOPIC & CONCURRENCY TESTS (Cases 10, 11, 17-22)
    // -------------------------------------------------------------------
    console.log('\n--- SECTION 2: Database, Multi-Topic, API & Concurrency Tests ---');

    // Seed test users
    const prof = await UserModel.createUser({
      username: `p572_prof_${ts}`,
      email: `p572_prof_${ts}@test.edu`,
      passwordHash,
      fullName: 'Professor 572',
      role: 'professor',
    });

    const studentA = await UserModel.createUser({
      username: `p572_alice_${ts}`,
      email: `p572_alice_${ts}@test.edu`,
      passwordHash,
      fullName: 'Alice 572',
      role: 'student',
    });

    const studentB = await UserModel.createUser({
      username: `p572_bob_${ts}`,
      email: `p572_bob_${ts}@test.edu`,
      passwordHash,
      fullName: 'Bob 572',
      role: 'student',
    });

    // Seed a contest
    const contestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'published')
       RETURNING id;`,
      [`Contest 572 ${ts}`, 'Contest Description', prof.id]
    );
    const contestId = contestRes.rows[0].id;

    // Seed 2 Problems: Problem 1 (Arrays + Hashing), Problem 2 (DP)
    const prob1Res = await db.query(
      `INSERT INTO problems (title, description, difficulty, coding_mode, created_by)
       VALUES ($1, $2, 'medium', 'full_program', $3) RETURNING id;`,
      [`Two Sum 572 ${ts}`, 'Find pairs that sum to target', prof.id]
    );
    const prob1Id = prob1Res.rows[0].id;

    const prob2Res = await db.query(
      `INSERT INTO problems (title, description, difficulty, coding_mode, created_by)
       VALUES ($1, $2, 'hard', 'full_program', $3) RETURNING id;`,
      [`Knapsack 572 ${ts}`, 'Dynamic programming knapsack', prof.id]
    );
    const prob2Id = prob2Res.rows[0].id;

    // Resolve topics
    const arraysTopic = await TopicModel.getTopicByKey('arrays');
    const hashingTopic = await TopicModel.getTopicByKey('hashing');
    const dpTopic = await TopicModel.getTopicByKey('dp');

    // Attach problem 1 to Arrays and Hashing
    await TopicModel.addTopicToProblem(prob1Id, arraysTopic.id);
    await TopicModel.addTopicToProblem(prob1Id, hashingTopic.id);

    // Attach problem 2 to DP
    await TopicModel.addTopicToProblem(prob2Id, dpTopic.id);

    // Case 10 & 11: Multi-topic tagged problem submission
    const sub1Res = await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, is_sample_run)
       VALUES ($1, $2, $3, 'print("accepted")', 'python', 'accepted', false)
       RETURNING id;`,
      [studentA.id, prob1Id, contestId]
    );
    const sub1Id = sub1Res.rows[0].id;

    // Case 21: Queue / event triggered recalculation
    await SkillCalculationService.processSubmissionEvent(sub1Id);

    const aliceArraysSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    const aliceHashingSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, hashingTopic.id);
    const aliceDpSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, dpTopic.id);

    record('21. Submission event automatically recalculates skill', aliceArraysSkill !== null);
    record('11. Multi-topic problem creates skill in Arrays (medium -> 30.00)', aliceArraysSkill?.score === 30.00);
    record('11. Multi-topic problem creates skill in Hashing (medium -> 30.00)', aliceHashingSkill?.score === 30.00);
    record('10. Multi-topic isolation: DP remains unpopulated (null)', aliceDpSkill === null);
    record('18. Persisted calculationVersion is 2 or newer', aliceArraysSkill?.calculationVersion >= 2);

    // Case 17: Concurrent / repeated recalculation idempotency
    await SkillCalculationService.recalculateUserTopicSkill(studentA.id, arraysTopic.id);
    await SkillCalculationService.recalculateUserTopicSkill(studentA.id, arraysTopic.id);
    const aliceArraysSkillAfter = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('17. Repeated recalculation is strictly idempotent', aliceArraysSkillAfter.score === aliceArraysSkill.score);

    // Case 22: Stale calculation protection
    const staleData = {
      score: 10.00,
      level: 'BEGINNER',
      confidence: 0.200,
      attemptedCount: 1,
      solvedCount: 1,
      lastAttemptAt: new Date('2020-01-01T00:00:00Z'), // Obsolete timestamp
      lastSolvedAt: new Date('2020-01-01T00:00:00Z'),
      calculationVersion: 2,
    };
    await SkillCalculationService.persistSkill(studentA.id, arraysTopic.id, staleData);
    const afterStaleAttempt = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('22. Stale calculation with older timestamp does NOT overwrite newer data', afterStaleAttempt.score === 30.00);

    // -------------------------------------------------------------------
    // 3. API & SECURITY PRIVACY BOUNDARY TESTS (Cases 19 & 20)
    // -------------------------------------------------------------------
    console.log('\n--- SECTION 3: API & Security Privacy Tests ---');

    // Login Alice and Bob
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

    // Alice views her own skills via API
    const ownSkillsRes = await request('GET', '/api/skills/my', null, aliceToken);
    record('Owner can fetch own skills with 200 OK', ownSkillsRes.status === 200);
    record('Owner sees full 0-100 score in API payload', ownSkillsRes.body.skills[0]?.score === 30.00);
    record('Owner sees calculationVersion in API payload', ownSkillsRes.body.skills[0]?.calculationVersion >= 2);

    // Case 19: Bob views Alice's skills (privacy filtered)
    const bobViewsAliceRes = await request('GET', `/api/skills/user/${studentA.username}`, null, bobToken);
    record('19. Other student can view public profile with 200 OK', bobViewsAliceRes.status === 200);
    record('19. Other student CANNOT see private score (undefined / omitted)', bobViewsAliceRes.body.skills[0]?.score === undefined);
    record('19. Other student can see public level (DEVELOPING)', bobViewsAliceRes.body.skills[0]?.level === 'DEVELOPING');

    // Case 20: Attempt to manually modify skillScore via API
    const tamperRes = await request('PUT', '/api/users/me', {
      fullName: 'Alice 572 Updated',
      score: 100.00,
      skills: [{ topicId: 1, score: 100.00 }],
    }, aliceToken);
    const aliceSkillsAfterTamper = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('20. Profile update returns 200 OK without crashing', tamperRes.status === 200);
    record('20. Server-side skill score remains immutable to client tampering (30.00)', aliceSkillsAfterTamper.score === 30.00);

  } catch (err) {
    console.error('[UNEXPECTED TEST EXCEPTION]:', err);
    failedCount++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 5.7.2 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
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
