/**
 * PHASE 5.7.1 AUTOMATED VERIFICATION TEST SUITE
 * Skill Data Model + Calculation Foundation
 * 
 * Verifies:
 * 1. Database Schema, Foreign Keys & Unique Constraints
 * 2. Canonical Topics & Multi-Topic Problem Mappings
 * 3. Evidence Collection & Unique Solved Deduplication
 * 4. SkillCalculationService (Collection, Calculation, Persistence separation)
 * 5. Background Post-Submission Event Processing Hook
 * 6. REST API Endpoints, Privacy Boundaries & Security Controls
 */

const http = require('http');
const { app } = require('./src/server');
const { initDb } = require('./src/config/initDb');
const db = require('./src/config/db');
const TopicModel = require('./src/models/topicModel');
const UserSkillModel = require('./src/models/userSkillModel');
const SkillCalculationService = require('./src/services/skillCalculationService');
const { generateToken } = require('./src/services/authService');

let server;
let baseUrl;
const ts = Date.now();

let studentA = {
  username: `skill_std_a_${ts}`,
  email: `skill_std_a_${ts}@test.com`,
  password: 'Password123!',
  fullName: 'Skill Student A',
};

let studentB = {
  username: `skill_std_b_${ts}`,
  email: `skill_std_b_${ts}@test.com`,
  password: 'Password123!',
  fullName: 'Skill Student B',
};

let tokenA = '';
let tokenB = '';
let userAId = null;
let userBId = null;

let problem1Id = null;
let problem2Id = null;
let topicArraysId = null;
let topicHashingId = null;
let topicDpId = null;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
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

async function runPhase571Tests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 5.7.1 AUTOMATED TEST SUITE');
  console.log(' Skill Data Model + Calculation Foundation');
  console.log('=======================================================\n');

  try {
    // 1. Initialize DB & seed topics
    await initDb();

    // Start ephemeral server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // -----------------------------------------------------------
    // SECTION 1: TOPIC REPOSITORY & DATA MODEL VERIFICATION
    // -----------------------------------------------------------
    console.log('--- 1. Topic Model & Taxonomy Verification ---');

    const allTopics = await TopicModel.getAllTopics();
    assert(Array.isArray(allTopics) && allTopics.length >= 16, `Platform contains ${allTopics.length} seeded canonical topics (>= 16)`);

    const topicArrays = await TopicModel.getTopicByKey('arrays');
    assert(topicArrays !== null && topicArrays.name === 'Arrays & Vectors', 'Resolved arrays topic by key');
    topicArraysId = topicArrays.id;

    const topicHashing = await TopicModel.getTopicByKey('hashing');
    assert(topicHashing !== null, 'Resolved hashing topic by key');
    topicHashingId = topicHashing.id;

    const topicDp = await TopicModel.getTopicByKey('dp');
    assert(topicDp !== null, 'Resolved dp topic by key');
    topicDpId = topicDp.id;

    // Create a dynamic new topic
    const customTopic = await TopicModel.createTopic({
      key: `geometry_${ts}`,
      name: 'Computational Geometry',
      category: 'Math',
      description: 'Geometric algorithms, convex hull, line sweep',
    });
    assert(customTopic.key === `geometry_${ts}`, 'Successfully created new topic dynamically');

    // -----------------------------------------------------------
    // SECTION 2: PROBLEM -> TOPIC RELATIONSHIP (MULTI-TOPIC)
    // -----------------------------------------------------------
    console.log('\n--- 2. Problem -> Topic Relationship & Multi-Topic Tagging ---');

    // Ensure we have a valid creator user
    const profRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role) 
       VALUES ($1, $2, 'hash123', 'Skill Prof', 'professor') 
       RETURNING id;`,
      [`skill_prof_${ts}`, `skill_prof_${ts}@test.com`]
    );
    const profId = profRes.rows[0].id;

    // Create test problems
    const p1Res = await db.query(
      `INSERT INTO problems (title, description, difficulty, created_by) 
       VALUES ($1, $2, 'easy', $3) RETURNING id;`,
      [`Two Sum Problem ${ts}`, 'Given an array of integers, find two numbers that add up to target.', profId]
    );
    problem1Id = p1Res.rows[0].id;

    const p2Res = await db.query(
      `INSERT INTO problems (title, description, difficulty, created_by) 
       VALUES ($1, $2, 'medium', $3) RETURNING id;`,
      [`Longest Substring Problem ${ts}`, 'Find longest non-repeating substring length.', profId]
    );
    problem2Id = p2Res.rows[0].id;

    // Assign multiple topics to Problem 1 (Arrays + Hashing)
    await TopicModel.assignTopicsToProblem(problem1Id, [topicArraysId, topicHashingId]);
    const p1Topics = await TopicModel.getTopicsByProblemId(problem1Id);
    assert(p1Topics.length === 2, 'Problem 1 successfully mapped to 2 topics (Arrays + Hashing)');
    assert(p1Topics.some((t) => t.key === 'arrays') && p1Topics.some((t) => t.key === 'hashing'), 'Multi-topic tags verified for Problem 1');

    // Assign DP topic to Problem 2
    await TopicModel.assignTopicsToProblem(problem2Id, [topicDpId]);
    const p2Topics = await TopicModel.getTopicsByProblemId(problem2Id);
    assert(p2Topics.length === 1 && p2Topics[0].key === 'dp', 'Problem 2 successfully mapped to DP topic');

    // Prevent duplicate mapping
    await TopicModel.addTopicToProblem(problem1Id, topicArraysId);
    const p1TopicsAfterDup = await TopicModel.getTopicsByProblemId(problem1Id);
    assert(p1TopicsAfterDup.length === 2, 'Duplicate topic association is safely ignored (idempotent)');

    // -----------------------------------------------------------
    // SECTION 3: USER SETUP & SUBMISSION ACTIVITY
    // -----------------------------------------------------------
    console.log('\n--- 3. User Setup & Submissions ---');

    const regResA = await request('POST', '/api/auth/register', studentA);
    userAId = regResA.body.user.id;
    tokenA = (await request('POST', '/api/auth/login', { email: studentA.email, password: studentA.password })).body.token;

    const regResB = await request('POST', '/api/auth/register', studentB);
    userBId = regResB.body.user.id;
    tokenB = (await request('POST', '/api/auth/login', { email: studentB.email, password: studentB.password })).body.token;

    // Create a test contest
    const contestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, 'Skill test contest', $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'published')
       RETURNING id;`,
      [`Skill Test Contest ${ts}`, profId]
    );
    const testContestId = contestRes.rows[0].id;

    // Insert submissions for Student A:
    // Problem 1 (Arrays, Hashing):
    // 1. Wrong answer
    // 2. Accepted
    // 3. Accepted (repeat solve on same problem)
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES 
         ($1, $2, $3, 'python', 'def solve(): pass', 'wrong_answer', 0, false, NOW() - INTERVAL '30 minutes'),
         ($1, $2, $3, 'python', 'def solve(): return [0, 1]', 'accepted', 100, false, NOW() - INTERVAL '20 minutes'),
         ($1, $2, $3, 'python', 'def solve(): return [0, 1] # v2', 'accepted', 100, false, NOW() - INTERVAL '10 minutes');`,
      [userAId, testContestId, problem1Id]
    );

    // -----------------------------------------------------------
    // SECTION 4: SKILL EVIDENCE COLLECTION & DEDUPLICATION
    // -----------------------------------------------------------
    console.log('\n--- 4. Skill Evidence Collection & Deduplication ---');

    const arraysEvidence = await SkillCalculationService.collectSkillEvidence(userAId, topicArraysId);
    assert(arraysEvidence.length === 3, `Collected ${arraysEvidence.length} raw evidence records for Arrays topic`);
    assert(arraysEvidence[0].topicKey === 'arrays', 'Evidence properly linked to Arrays topic');
    assert(arraysEvidence[0].problemId === problem1Id, 'Evidence properly linked to Problem 1');

    // Calculate skill from evidence
    const arraysSkill = SkillCalculationService.calculateSkill(arraysEvidence);
    assert(arraysSkill.attemptedCount === 3, `Calculated attemptedCount is 3`);
    assert(arraysSkill.solvedCount === 1, `Deduplicated solvedCount is strictly 1 (repeat solve on same problem counted once)`);
    assert(arraysSkill.score > 0, `Calculated foundation score: ${arraysSkill.score}`);
    assert(arraysSkill.level === 'BEGINNER' || arraysSkill.level === 'DEVELOPING', `Calculated foundation level: ${arraysSkill.level}`);
    assert(arraysSkill.confidence > 0, `Calculated foundation confidence: ${arraysSkill.confidence}`);
    assert(arraysSkill.calculationVersion >= 1, `Calculation version is ${arraysSkill.calculationVersion}`);

    // -----------------------------------------------------------
    // SECTION 5: PERSISTENCE & UNIQUE CONSTRAINT ENFORCEMENT
    // -----------------------------------------------------------
    console.log('\n--- 5. UserSkill Persistence & Unique Constraint ---');

    const persistedArrays = await SkillCalculationService.persistSkill(userAId, topicArraysId, arraysSkill);
    assert(persistedArrays.userId === userAId && persistedArrays.topicId === topicArraysId, 'Persisted UserSkill to database');
    assert(persistedArrays.solvedCount === 1, 'Persisted solvedCount verified');

    // Update with new calculation (idempotent upsert, no duplicate row)
    const updatedArraysSkill = { ...arraysSkill, score: 250.00 };
    await SkillCalculationService.persistSkill(userAId, topicArraysId, updatedArraysSkill);

    const userSkills = await UserSkillModel.getUserSkills(userAId);
    assert(userSkills.length === 1, 'Exactly one UserSkill record exists for (userA, Arrays topic)');
    assert(userSkills[0].score === 250.00, 'Score updated atomically on conflict');

    // -----------------------------------------------------------
    // SECTION 6: BACKGROUND EVENT PROCESSING HOOK
    // -----------------------------------------------------------
    console.log('\n--- 6. Background Event Processing Hook ---');

    // Create a new submission for Student A on Problem 2 (DP)
    const subDpRes = await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'python', 'dp solution', 'accepted', 100, false, NOW())
       RETURNING id;`,
      [userAId, testContestId, problem2Id]
    );
    const subDpId = subDpRes.rows[0].id;

    // Trigger event processing
    await SkillCalculationService.processSubmissionEvent(subDpId);

    const userSkillsAfterEvent = await UserSkillModel.getUserSkills(userAId);
    assert(userSkillsAfterEvent.length === 2, 'User A now has 2 skill records (Arrays + DP) populated via event hook');
    const dpSkill = userSkillsAfterEvent.find((s) => s.topicKey === 'dp');
    assert(dpSkill !== undefined && dpSkill.solvedCount === 1, 'DP skill created and updated automatically');

    // -----------------------------------------------------------
    // SECTION 7: REST API ENDPOINTS & AUTHORIZATION SECURITY
    // -----------------------------------------------------------
    console.log('\n--- 7. REST API Endpoints & Privacy Boundaries ---');

    // 7.1 GET /api/skills/topics (Public)
    const topicsRes = await request('GET', '/api/skills/topics');
    assert(topicsRes.status === 200, 'GET /api/skills/topics returns 200 OK');
    assert(Array.isArray(topicsRes.body.topics), 'Returns topics array');

    // 7.2 GET /api/skills/my (Authenticated)
    const mySkillsRes = await request('GET', '/api/skills/my', null, tokenA);
    assert(mySkillsRes.status === 200, 'GET /api/skills/my returns 200 OK');
    assert(mySkillsRes.body.count === 2, 'Returns 2 skills for authenticated user');
    assert(mySkillsRes.body.summary.totalTopicsTracked === 2, 'Summary tracks 2 topics');
    assert(mySkillsRes.body.summary.totalSolvedAcrossTopics === 2, 'Summary tracks 2 total solved problems across topics');

    // 7.3 GET /api/users/me/skills (Alias endpoint)
    const userMeSkillsRes = await request('GET', '/api/users/me/skills', null, tokenA);
    assert(userMeSkillsRes.status === 200, 'GET /api/users/me/skills returns 200 OK');
    assert(userMeSkillsRes.body.skills.length === 2, 'Alias endpoint returns identical skills payload');

    // 7.4 Unauthenticated request to /api/skills/my -> 401
    const unauthSkillsRes = await request('GET', '/api/skills/my');
    assert(unauthSkillsRes.status === 401, 'Unauthenticated request to /api/skills/my returns 401 Unauthorized');

    // 7.5 Privacy Boundary: Student B viewing Student A's skills via /api/skills/user/:username
    const publicSkillsRes = await request('GET', `/api/skills/user/${studentA.username}`, null, tokenB);
    assert(publicSkillsRes.status === 200, 'GET /api/skills/user/:username returns 200 OK for other user');
    assert(publicSkillsRes.body.isOwnProfile === false, 'Indicates isOwnProfile is false');
    assert(publicSkillsRes.body.skills[0].score === undefined, 'Private skill score is hidden from other students');
    assert(publicSkillsRes.body.skills[0].topicName !== undefined, 'Public topic name is visible');
    assert(publicSkillsRes.body.skills[0].level !== undefined, 'Public skill level is visible');

    // 7.6 Student A viewing their own skills via /api/skills/user/:username
    const ownSkillsRes = await request('GET', `/api/skills/user/${studentA.username}`, null, tokenA);
    assert(ownSkillsRes.status === 200, 'GET /api/skills/user/:username returns 200 OK for owner');
    assert(ownSkillsRes.body.isOwnProfile === true, 'Indicates isOwnProfile is true');
    assert(ownSkillsRes.body.skills[0].score !== undefined, 'Owner can see full skill score');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 5.7.1 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runPhase571Tests().then(() => {
    require('./src/config/db').closePool().then(() => process.exit(0));
  });
}

module.exports = runPhase571Tests;
