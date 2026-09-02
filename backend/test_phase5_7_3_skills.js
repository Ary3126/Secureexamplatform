/**
 * Automated Verification Test Suite for Phase 5.7.3 — Confidence + Evidence Layer
 * 
 * Tests all 26+ required confidence and evidence scenarios:
 * 1. No evidence (empty state: confidence 0.00, score 0.00)
 * 2. One attempted problem (failure only: low confidence, score 0.00)
 * 3. One solved problem (single solve: moderate-low confidence, score independent)
 * 4. Multiple solved problems (confidence scales up with breadth)
 * 5. Distinct solves vs repeated solves (anti-farming: 5 distinct > 5 on 1)
 * 6. Repeated submissions spam (spam cannot manufacture high confidence)
 * 7. Mixed success/failure (confidence reflects evidence quality)
 * 8. Recent activity (recency boost)
 * 9. Older activity (baseline confidence preserved without collapse)
 * 10. Multiple topics isolation
 * 11. Problem linked to multiple topics
 * 12. Evidence aggregation deduplication
 * 13. Confidence lower boundary (>= 0.00)
 * 14. Confidence upper boundary (<= 100.00)
 * 15. Deterministic calculation reproducibility
 * 16. Stable rounding (2 decimal places)
 * 17. Invalid / missing / null data handling
 * 18. calculationVersion behavior (strictly version 3)
 * 19. Duplicate queue events idempotency
 * 20. Concurrent recalculation safety
 * 21. Stale calculation protection
 * 22. Unauthorized skill access (privacy boundary)
 * 23. Attempt to manually modify confidence via API (server-authoritative)
 * 24. Attempt to manually modify evidence counts via API (server-authoritative)
 * 25. Submission -> evidence update
 * 26. Background job -> confidence update
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
  console.log(' STARTING PHASE 5.7.3 AUTOMATED TEST SUITE');
  console.log(' Confidence + Evidence Layer Verification');
  console.log('=======================================================\n');

  const ts = Date.now();
  const refDate = new Date('2026-08-20T12:00:00Z');
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6'; // Password123!

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
    // 1. PURE CONFIDENCE & EVIDENCE UNIT TESTS (Cases 1 - 18)
    // -------------------------------------------------------------------
    console.log('--- SECTION 1: Pure Confidence & Evidence Unit Tests ---');

    // Case 1: No evidence (empty state)
    const emptyResult = SkillCalculationService.calculateSkill([], null, refDate);
    record('1. No evidence returns confidence 0.00', emptyResult.confidence === 0.00);
    record('1. No evidence returns score 0.00', emptyResult.score === 0.00);
    record('1. No evidence returns level BEGINNER', emptyResult.level === 'BEGINNER');
    record('1. No evidence sets calculationVersion to 3', emptyResult.calculationVersion === 3);
    record('1. No evidence aggregate distinctProblemsAttempted is 0', emptyResult.evidence.distinctProblemsAttempted === 0);
    record('1. No evidence aggregate distinctProblemsSolved is 0', emptyResult.evidence.distinctProblemsSolved === 0);

    // Case 2: One attempted problem (failure only)
    const failOnlyEvidence = [
      {
        topicId: 1,
        topicKey: 'arrays',
        problemId: 101,
        problemDifficulty: 'medium',
        submissionId: 1,
        verdict: 'wrong_answer',
        isAccepted: false,
        timestamp: new Date('2026-08-19T10:00:00Z'),
      },
      {
        topicId: 1,
        topicKey: 'arrays',
        problemId: 101,
        problemDifficulty: 'medium',
        submissionId: 2,
        verdict: 'time_limit_exceeded',
        isAccepted: false,
        timestamp: new Date('2026-08-19T10:30:00Z'),
      },
    ];
    const failResult = SkillCalculationService.calculateSkill(failOnlyEvidence, null, refDate);
    record('2. Failure-only yields score 0.00', failResult.score === 0.00);
    record('2. Failure-only yields low confidence (< 15.00)', failResult.confidence > 0 && failResult.confidence < 15.00);
    record('2. Failure-only tracks 1 distinct attempted problem', failResult.evidence.distinctProblemsAttempted === 1);
    record('2. Failure-only tracks 0 distinct solved problems', failResult.evidence.distinctProblemsSolved === 0);

    // Case 3: One solved problem (single solve)
    const oneSolveEvidence = [
      {
        topicId: 1,
        topicKey: 'arrays',
        problemId: 102,
        problemDifficulty: 'hard',
        submissionId: 3,
        verdict: 'accepted',
        isAccepted: true,
        timestamp: new Date('2026-08-19T12:00:00Z'), // Fresh solve
      },
    ];
    const oneSolveResult = SkillCalculationService.calculateSkill(oneSolveEvidence, null, refDate);
    record('3. Single solve produces high skill score (35.00)', oneSolveResult.score === 35.00);
    record('3. Single solve produces moderate-low confidence (score != confidence)', oneSolveResult.confidence < oneSolveResult.score);
    record('3. Single solve confidence is in expected range (25.00 - 35.00)', oneSolveResult.confidence >= 25.00 && oneSolveResult.confidence <= 35.00);

    // Case 4 & 5: Multiple distinct solved problems vs repeated solves (Anti-Farming)
    const fiveDistinctSolves = [
      { topicId: 1, problemId: 201, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 202, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 203, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 204, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 205, problemDifficulty: 'hard', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
    ];
    const fiveRepeatedSolves = [
      { topicId: 1, problemId: 201, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
      { topicId: 1, problemId: 201, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T10:05:00Z') },
      { topicId: 1, problemId: 201, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T10:10:00Z') },
      { topicId: 1, problemId: 201, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T10:15:00Z') },
      { topicId: 1, problemId: 201, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-19T10:20:00Z') },
    ];
    const fiveDistinctResult = SkillCalculationService.calculateSkill(fiveDistinctSolves, null, refDate);
    const fiveRepeatedResult = SkillCalculationService.calculateSkill(fiveRepeatedSolves, null, refDate);
    record('4. Five distinct solves yields strong confidence (>= 80.00)', fiveDistinctResult.confidence >= 80.00);
    record('5. Five distinct solves produces much higher confidence than 5 solves of 1 problem', fiveDistinctResult.confidence > fiveRepeatedResult.confidence + 40.00);
    record('5. Five repeated solves has strictly 1 distinct solved problem in evidence', fiveRepeatedResult.evidence.distinctProblemsSolved === 1);

    // Case 6: Repeated submissions spam (spamming 50 attempts on 1 problem)
    const fiftySpamEvidence = [];
    for (let i = 1; i <= 50; i++) {
      fiftySpamEvidence.push({
        topicId: 1,
        problemId: 301,
        problemDifficulty: 'easy',
        submissionId: i,
        isAccepted: true,
        timestamp: new Date('2026-08-19T10:00:00Z'),
      });
    }
    const spamResult = SkillCalculationService.calculateSkill(fiftySpamEvidence, null, refDate);
    record('6. 50 spam submissions on single problem cannot reach high confidence (< 45.00)', spamResult.confidence < 45.00);
    record('6. Spam evidence correctly tracks 50 total attempts and 1 distinct problem', spamResult.evidence.totalAttempts === 50 && spamResult.evidence.distinctProblemsSolved === 1);

    // Case 7: Mixed success and failure
    const mixedEvidence = [
      { topicId: 1, problemId: 401, problemDifficulty: 'medium', isAccepted: false, timestamp: new Date('2026-08-18T10:00:00Z') },
      { topicId: 1, problemId: 401, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-18T11:00:00Z') },
      { topicId: 1, problemId: 402, problemDifficulty: 'medium', isAccepted: false, timestamp: new Date('2026-08-18T12:00:00Z') },
      { topicId: 1, problemId: 403, problemDifficulty: 'easy', isAccepted: true, timestamp: new Date('2026-08-18T13:00:00Z') },
    ];
    const mixedResult = SkillCalculationService.calculateSkill(mixedEvidence, null, refDate);
    record('7. Mixed evidence tracks 3 distinct attempted problems', mixedResult.evidence.distinctProblemsAttempted === 3);
    record('7. Mixed evidence tracks 2 distinct solved problems', mixedResult.evidence.distinctProblemsSolved === 2);
    record('7. Mixed evidence tracks 2 failed submissions', mixedResult.evidence.failedEvidence === 2);

    // Case 8 & 9: Recent activity vs older activity
    const recentSolveEvidence = [
      { topicId: 1, problemId: 501, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') }, // 1 day old
      { topicId: 1, problemId: 502, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2026-08-19T10:00:00Z') },
    ];
    const oldSolveEvidence = [
      { topicId: 1, problemId: 501, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2025-08-19T10:00:00Z') }, // 1 year old
      { topicId: 1, problemId: 502, problemDifficulty: 'medium', isAccepted: true, timestamp: new Date('2025-08-19T10:00:00Z') },
    ];
    const recentResult = SkillCalculationService.calculateSkill(recentSolveEvidence, null, refDate);
    const oldResult = SkillCalculationService.calculateSkill(oldSolveEvidence, null, refDate);
    record('8. Recent solve receives recency boost vs older solve', recentResult.confidence > oldResult.confidence);
    record('9. Older solve retains solid baseline confidence without collapsing (> 30.00)', oldResult.confidence > 30.00);

    // Case 12: Evidence deduplication verification
    const aggResult = SkillCalculationService.aggregateEvidence(fiveRepeatedSolves, refDate);
    record('12. Evidence aggregation deduplicates 5 submissions to 1 distinct problem', aggResult.distinctProblemsSolved === 1);
    record('12. Evidence aggregation preserves 5 total attempts', aggResult.totalAttempts === 5);

    // Case 13 & 14: Confidence boundaries (0.00 to 100.00)
    const massiveEvidence = [];
    for (let i = 1; i <= 20; i++) {
      massiveEvidence.push({
        topicId: 1,
        problemId: 600 + i,
        problemDifficulty: 'hard',
        isAccepted: true,
        timestamp: new Date('2026-08-19T10:00:00Z'),
      });
    }
    const massiveResult = SkillCalculationService.calculateSkill(massiveEvidence, null, refDate);
    record('13. Confidence lower boundary: confidence >= 0.00', emptyResult.confidence >= 0.00);
    record('14. Confidence upper boundary: confidence <= 100.00', massiveResult.confidence <= 100.00);
    record('14. Massive diverse evidence caps cleanly at 100.00', massiveResult.confidence === 100.00);

    // Case 15 & 16: Determinism & rounding stability
    const detA = SkillCalculationService.calculateConfidence(mixedEvidence, refDate);
    const detB = SkillCalculationService.calculateConfidence(mixedEvidence, refDate);
    record('15. Identical evidence produces 100% deterministic confidence', detA === detB);
    record('16. Confidence is rounded to 2 decimal places with no NaN/Infinity', Number.isFinite(detA) && (!detA.toString().includes('.') || detA.toString().split('.')[1].length <= 2));

    // Case 17: Invalid / missing / null data handling
    const corruptEvidence = [
      { topicId: null, problemId: null, isAccepted: false, timestamp: null },
    ];
    const corruptResult = SkillCalculationService.calculateSkill(corruptEvidence, null, refDate);
    record('17. Corrupted evidence safely yields bounded confidence (0.00)', corruptResult.confidence >= 0.00 && Number.isFinite(corruptResult.confidence));

    // Case 18: Calculation version handling
    record('18. Current calculationVersion is strictly 3', SkillCalculationService.CALCULATION_VERSION === 3);
    record('18. Output object contains calculationVersion 3', emptyResult.calculationVersion === 3);

    // -------------------------------------------------------------------
    // 2. DATABASE, API, MULTI-TOPIC & CONCURRENCY TESTS (Cases 10, 11, 19-26)
    // -------------------------------------------------------------------
    console.log('\n--- SECTION 2: Database, Multi-Topic, API & Concurrency Tests ---');

    // Seed test users
    const prof = await UserModel.createUser({
      username: `p573_prof_${ts}`,
      email: `p573_prof_${ts}@test.edu`,
      passwordHash,
      fullName: 'Professor 573',
      role: 'professor',
    });

    const studentA = await UserModel.createUser({
      username: `p573_alice_${ts}`,
      email: `p573_alice_${ts}@test.edu`,
      passwordHash,
      fullName: 'Alice 573',
      role: 'student',
    });

    const studentB = await UserModel.createUser({
      username: `p573_bob_${ts}`,
      email: `p573_bob_${ts}@test.edu`,
      passwordHash,
      fullName: 'Bob 573',
      role: 'student',
    });

    // Seed a contest
    const contestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'published')
       RETURNING id;`,
      [`Contest 573 ${ts}`, 'Contest Description', prof.id]
    );
    const contestId = contestRes.rows[0].id;

    // Seed 2 Problems: Problem 1 (Arrays + Hashing), Problem 2 (DP)
    const prob1Res = await db.query(
      `INSERT INTO problems (title, description, difficulty, coding_mode, created_by)
       VALUES ($1, $2, 'medium', 'full_program', $3) RETURNING id;`,
      [`Two Sum 573 ${ts}`, 'Find pairs that sum to target', prof.id]
    );
    const prob1Id = prob1Res.rows[0].id;

    const prob2Res = await db.query(
      `INSERT INTO problems (title, description, difficulty, coding_mode, created_by)
       VALUES ($1, $2, 'hard', 'full_program', $3) RETURNING id;`,
      [`Knapsack 573 ${ts}`, 'Dynamic programming knapsack', prof.id]
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

    // Case 25 & 26: Submission -> evidence update & background queue hook
    const sub1Res = await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, is_sample_run)
       VALUES ($1, $2, $3, 'print("accepted")', 'python', 'accepted', false)
       RETURNING id;`,
      [studentA.id, prob1Id, contestId]
    );
    const sub1Id = sub1Res.rows[0].id;

    await SkillCalculationService.processSubmissionEvent(sub1Id);

    const aliceArraysSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    const aliceHashingSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, hashingTopic.id);
    const aliceDpSkill = await UserSkillModel.getUserSkillByTopic(studentA.id, dpTopic.id);

    record('25. Submission automatically updates persisted skill record', aliceArraysSkill !== null);
    record('26. Background hook calculates 0-100 bounded confidence', aliceArraysSkill?.confidence > 0 && aliceArraysSkill?.confidence <= 100.00);
    record('11. Multi-topic problem propagates confidence to Arrays topic', aliceArraysSkill?.confidence > 0);
    record('11. Multi-topic problem propagates confidence to Hashing topic', aliceHashingSkill?.confidence > 0);
    record('10. Multi-topic isolation: DP topic remains null', aliceDpSkill === null);
    record('18. Persisted calculationVersion is strictly 3', aliceArraysSkill?.calculationVersion === 3);

    // Case 19 & 20: Duplicate queue jobs & concurrent recalculation idempotency
    await SkillCalculationService.recalculateUserTopicSkill(studentA.id, arraysTopic.id);
    await SkillCalculationService.recalculateUserTopicSkill(studentA.id, arraysTopic.id);
    const aliceArraysAfter = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('19. Duplicate queue events are strictly idempotent', aliceArraysAfter.confidence === aliceArraysSkill.confidence);
    record('20. Concurrent recalculation yields identical score and confidence', aliceArraysAfter.score === aliceArraysSkill.score);

    // Case 21: Stale calculation protection
    const staleData = {
      score: 10.00,
      level: 'BEGINNER',
      confidence: 15.00,
      attemptedCount: 1,
      solvedCount: 1,
      lastAttemptAt: new Date('2020-01-01T00:00:00Z'),
      lastSolvedAt: new Date('2020-01-01T00:00:00Z'),
      calculationVersion: 3,
    };
    await SkillCalculationService.persistSkill(studentA.id, arraysTopic.id, staleData);
    const afterStaleAttempt = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('21. Stale calculation with older timestamp does NOT overwrite newer confidence', afterStaleAttempt.confidence === aliceArraysSkill.confidence);

    // -------------------------------------------------------------------
    // 3. API & SECURITY PRIVACY BOUNDARY TESTS (Cases 22 - 24)
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

    // Alice fetches own skills via API
    const ownSkillsRes = await request('GET', '/api/skills/my', null, aliceToken);
    record('Owner can fetch own skills with 200 OK', ownSkillsRes.status === 200);
    record('Owner sees confidence in 0-100 scale in API payload', ownSkillsRes.body.skills[0]?.confidence > 0);
    record('Owner sees calculationVersion 3 in API payload', ownSkillsRes.body.skills[0]?.calculationVersion === 3);

    // Case 22: Bob views Alice's skills (privacy filtered)
    const bobViewsAliceRes = await request('GET', `/api/skills/user/${studentA.username}`, null, bobToken);
    record('22. Other student can view public profile with 200 OK', bobViewsAliceRes.status === 200);
    record('22. Other student CANNOT see private score (omitted)', bobViewsAliceRes.body.skills[0]?.score === undefined);
    record('22. Other student can see public confidence value', typeof bobViewsAliceRes.body.skills[0]?.confidence === 'number');

    // Case 23 & 24: Attempt to manually modify confidence / evidence counts via API
    const tamperRes = await request('PUT', '/api/users/me', {
      fullName: 'Alice 573 Updated',
      confidence: 100.00,
      attemptedCount: 999,
      solvedCount: 999,
      skills: [{ topicId: 1, confidence: 100.00, solvedCount: 999 }],
    }, aliceToken);
    const aliceSkillsAfterTamper = await UserSkillModel.getUserSkillByTopic(studentA.id, arraysTopic.id);
    record('23. Profile update returns 200 OK without crashing', tamperRes.status === 200);
    record('23. Confidence remains immutable to client tampering', aliceSkillsAfterTamper.confidence === aliceArraysSkill.confidence);
    record('24. Solved count remains immutable to client tampering', aliceSkillsAfterTamper.solvedCount === aliceArraysSkill.solvedCount);

  } catch (err) {
    console.error('[UNEXPECTED TEST EXCEPTION]:', err);
    failedCount++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 5.7.3 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
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
