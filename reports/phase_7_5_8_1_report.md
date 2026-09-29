# Phase 7.5.8.1 — Leaderboard & Results Architecture Audit

## 1. Audit Objective

The objective of this audit is to conduct an exhaustive, code-level investigation of the existing leaderboard, scoring, ranking, contest freeze, snapshot, results, and rating architecture in ExamForge.

ExamForge is an enterprise-grade, college-focused Coding Practice, Competitive Programming & Secure Examination Platform. As part of **Phase 7.5 (Contest Management)**, sub-phase **7.5.8** addresses **Leaderboard & Results**.

### Critical Audit Mandate:
- **STRICTLY AUDIT ONLY**: No backend source code, frontend source code, database schemas, migrations, APIs, or tests were altered during this audit.
- **NO PREMATURE REBUILDING**: Identify existing working patterns, algorithms, models, and UI components to ensure zero redundant development.
- **AUTHORITATIVE TRUTH**: Determine how contest standings are calculated, how ties are broken, how submissions affect scores, how freeze mechanics function, how ratings interact with finalized contests, and what security or architectural gaps exist before implementing Phase 7.5.8.2 through 7.5.8.9.

---

## 2. Repository Areas Inspected

The following source files, database schemas, configuration files, and test suites across the repository were comprehensively examined:

### Backend Services & Models
- `backend/src/services/standingsService.js` — Single source of truth for contest standings, problem matrix calculation, freeze cutoff, tie-breaking, and pagination.
- `backend/src/services/ratingService.js` — Authoritative Multi-Participant Elo rating calculation, rating change derivation, and transactional contest finalization.
- `backend/src/services/contestService.js` — Contest lifecycle resolution, runtime state determination (`draft`, `upcoming`, `running`, `ended`, `archived`), and contest formatting.
- `backend/src/services/globalRankingService.js` — Platform-wide and college-wide global rating leaderboards and platform snapshot creation.
- `backend/src/controllers/contestController.js` — Handlers for `getContestLeaderboard` and `finalizeContestRatings`.
- `backend/src/controllers/leaderboardController.js` — Handlers for global and college-level rating leaderboards and platform snapshots.
- `backend/src/routes/contestRoutes.js` — Routing and middleware for `GET /api/contests/:id/leaderboard` and `POST /api/contests/:id/finalize-ratings`.
- `backend/src/routes/leaderboardRoutes.js` — Routing for global ratings and snapshots (`/api/leaderboard/*`).
- `backend/src/models/contestModel.js` — Contest database queries, problem association, and configuration fields.
- `backend/src/models/ratingModel.js` — Rating history queries, user rating mutations, and finalization status checks.
- `backend/src/config/ratingConfig.js` — K-factors, provisional contest thresholds, and rating parameters.
- `backend/src/services/auditLogger.js` — Persistent audit logging for contest finalization.

### Frontend Components & Views
- `frontend/src/components/ContestLeaderboard.jsx` — Student-facing contest leaderboard with live countdown timer, auto-refresh polling, freeze banner, top-3 podium, sticky user position banner, problem matrix table, and pagination.
- `frontend/src/App.jsx` — Application routing and navigation context for the `leaderboard` view.
- `frontend/src/components/admin/AdminContestManagement.jsx` — Admin contest discovery, inspection drawer, and management actions.
- `frontend/src/components/admin/AdminContestProblemList.jsx` — Attached problem management within contest inspection drawer.
- `frontend/src/components/admin/AdminContestParticipantList.jsx` — Enrolled participant list within contest inspection drawer.
- `frontend/src/components/GlobalLeaderboard.jsx` — Global rating leaderboard component.

### Database Schemas & PostgreSQL Tables
- `backend/src/database/schema.sql` — Authoritative PostgreSQL DDL definitions for:
  - `contests` (including `leaderboard_freeze_enabled`, `leaderboard_freeze_minutes`, `is_rating_finalized`, `ratings_finalized_at`)
  - `contest_problems` (`contest_id`, `problem_id`, `problem_order`, `points`)
  - `contest_participants` (`contest_id`, `user_id`, `joined_at`)
  - `submissions` (`id`, `user_id`, `contest_id`, `problem_id`, `status`, `score`, `execution_time`, `memory_used`, `is_sample_run`, `created_at`)
  - `rating_history` (`user_id`, `contest_id`, `previous_rating`, `rating_change`, `new_rating`, `rank`, `participant_count`, `performance_rating`, `rating_status`)
  - `leaderboard_snapshots` (`id`, `snapshot_date`, `scope`, `institution`, `user_id`, `rank`, `rating`, `highest_rating`, `rating_status`, `rated_contest_count`)

### Test Suites
- `frontend/test_phase5_5.js` — 36-step automated integration test suite covering contest creation, participant enrollment, multi-submission scoring, problem matrix validation, search, server-side pagination, freeze masking, freeze override bypass, rating finalization, and finalization idempotency.
- `backend/test_admin_phase5_5_9_scoring_consistency.js` — Automated backend test verifying dynamic points assignment (`cp.points`), scoring consistency in `StandingsService`, judge queue evaluation, and lifecycle lock interaction.
- `backend/test_public_practice_submission_context.js` — Verifies submission separation between practice and contest contexts.

---

## 3. Existing Architecture

### Architectural Type
- **Dynamic On-Demand Calculation**: Contest leaderboards are **not** precomputed or stored as cached tables in the database.
- **Single Source of Truth**: When a client requests `GET /api/contests/:id/leaderboard`, the backend executes `StandingsService.computeContestStandings({ contestId, requestingUser, page, limit, search, freezeOverride })`.
- **Hybrid Snapshot Model for Ratings**: While the contest scoreboard itself is dynamically aggregated from raw `submissions`, finalized contest rankings and rating updates are permanently recorded in `rating_history`. Furthermore, the `leaderboard_snapshots` table is dedicated to periodic global/college platform rating distributions (Phase 5.6), not individual contest scoreboards.

### Data Flow Diagram

```
+-----------------------------------------------------------------------------------+
|                                STUDENT SUBMISSION                                 |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  POST /api/submissions (contest_id, problem_id, language, source_code)           |
|  - Saved to 'submissions' table (status: 'queued', is_sample_run: false)          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  JUDGE QUEUE & RUNTIME EVALUATION (Docker Workers)                                |
|  - Executes against hidden and visible test cases                                 |
|  - Calculates score dynamically from contest_problems.points                      |
|  - Updates 'submissions' table (status: 'accepted' | 'wrong_answer' | etc.)       |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  STANDINGS SERVICE REQUEST: GET /api/contests/:id/leaderboard                     |
+-----------------------------------------------------------------------------------+
                                         |
                                         +---> 1. Fetch Contest & Freeze Window
                                         |        (freezeTime = endTime - freezeMinutes)
                                         |
                                         +---> 2. Determine Freeze Cutoff
                                         |        (if active && !managerOverride: s.created_at <= freezeTime)
                                         |
                                         +---> 3. Fetch Contest Problems (ordered by problem_order ASC)
                                         |
                                         +---> 4. Fetch Enrolled Students (from contest_participants)
                                         |
                                         +---> 5. Fetch Submissions (filtered by contest_id & cutoff)
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  IN-MEMORY SCOREBOARD EVALUATION                                                  |
|  - Groups submissions by userId -> problemId                                      |
|  - Identifies first accepted submission per problem                               |
|  - Calculates penalty: acceptedTimeMinutes + (failedAttemptsBeforeSolve * 20)      |
|  - Computes totalScore, totalPenaltyMinutes, totalTimeMs, solvedProblemsCount     |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  DETERMINISTIC RANKING & TIE-BREAKING                                             |
|  - Sort: totalScore DESC -> totalPenaltyMinutes ASC -> lastAcceptedAt ASC        |
|          -> totalTimeMs ASC -> userId ASC                                         |
|  - Assign sequential ranks with standard tie parity (identical metrics = same rank)|
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  PAYLOAD AGGREGATION & PAGINATION                                                 |
|  - Extract Top 3 Podium (Gold, Silver, Bronze)                                    |
|  - Locate requesting user's position (+ rating delta if finalized)                |
|  - Filter by search query (username/name) & paginate (slice by page, limit)       |
|  - Compute contest summary metrics (participants, problems, top/avg/median score) |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|  JSON RESPONSE: Returned to Client / ContestLeaderboard Component                 |
+-----------------------------------------------------------------------------------+
```

---

## 4. Existing Backend APIs

The table below lists all existing endpoints related to leaderboards, contest standings, and rating finalization:

| Method | Endpoint | Purpose | Auth Required | Roles Permitted | Data Source | Freeze Aware | Lifecycle Aware | Tests |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/contests/:id/leaderboard` | Fetch live or frozen contest standings, problem matrix, podium, user position, and summary | Optional Auth (`optionalAuthenticate`) | Public, Student, Professor, Contest Admin, Super Admin | `contests`, `contest_problems`, `contest_participants`, `submissions`, `rating_history` | **Yes** (Masks submissions created after `freezeTime` unless manager with `freezeOverride=true`) | **Partial** (Returns 404 if not found; lacks draft block) | `frontend/test_phase5_5.js`, `test_admin_phase5_5_9_scoring_consistency.js` |
| `POST` | `/api/contests/:id/finalize-ratings` | Finalize contest standings and apply pairwise Elo rating updates inside an ACID transaction | Strict Auth (`authenticate`) | Professor (contest owner), Contest Admin, Super Admin | `contests`, `StandingsService`, `rating_history`, `users`, `audit_logs` | **Yes** (Evaluates unmasked standings with `freezeOverride: true`, sets `is_rating_finalized=true`) | **Yes** (Requires contest to be published and ended, unless `force: true`) | `frontend/test_phase5_5.js` |
| `GET` | `/api/leaderboard` | Fetch platform-wide or college-scoped user rating leaderboard | Optional Auth (`optionalAuthenticate`) | Public, All Users | `users`, `rating_history` | No (Platform rating scope) | N/A | `test_phase5_6.js` |
| `GET` | `/api/leaderboard/global` | Fetch platform-wide global rating rankings | Optional Auth (`optionalAuthenticate`) | Public, All Users | `users` | No | N/A | `test_phase5_6.js` |
| `GET` | `/api/leaderboard/college` | Fetch institution-scoped user rating rankings | Optional Auth (`optionalAuthenticate`) | Public, All Users | `users` | No | N/A | `test_phase5_6.js` |
| `GET` | `/api/leaderboard/stats` | Fetch rating tier distribution and platform statistics | Public | Public, All Users | `users` | No | N/A | `test_phase5_6.js` |
| `POST` | `/api/leaderboard/snapshots` | Trigger historical platform rating snapshot | Strict Auth (`authenticate`) | Professor, Super Admin | `users` $\rightarrow$ `leaderboard_snapshots` | No | N/A | `test_phase5_6.js` |
| `GET` | `/api/leaderboard/snapshots` | Fetch historical platform rating snapshots | Optional Auth (`optionalAuthenticate`) | Public, All Users | `leaderboard_snapshots` | No | N/A | `test_phase5_6.js` |

---

## 5. Existing Scoring Logic

Contest scoring is implemented in `StandingsService.computeContestStandings` (`backend/src/services/standingsService.js` lines 144–233).

### 1. Problem Point Allocation
- Points for each problem are defined in `contest_problems.points` (default 100, configurable per problem up to 100,000).
- Problem details are loaded via:
  ```sql
  SELECT cp.problem_id AS "problemId", cp.problem_order AS "problemOrder", cp.points AS "maxPoints",
         p.title, p.difficulty, p.coding_mode AS "codingMode"
  FROM contest_problems cp
  JOIN problems p ON cp.problem_id = p.id
  WHERE cp.contest_id = $1
  ORDER BY cp.problem_order ASC, cp.problem_id ASC;
  ```

### 2. Solve Detection & Point Awarding
- For a given participant and problem, submissions are traversed chronologically (`ORDER BY s.created_at ASC`).
- A problem is flagged as solved (`isSolved = true`) upon encountering the first submission where `sub.status === 'accepted'`.
- The participant is awarded the full `prob.maxPoints` for that problem:
  ```javascript
  if (isSolved && firstAcceptedSub) {
    solvedCount++;
    totalScore += prob.maxPoints;
    ...
  }
  ```

### 3. ICPC Penalty Calculation
- **Time Component**: Minutes elapsed from contest start time (`startTime`) to the first accepted submission (`submittedAt`):
  ```javascript
  const subTime = new Date(firstAcceptedSub.submittedAt);
  acceptedTimeOffsetMin = Math.max(0, Math.floor((subTime.getTime() - startTime.getTime()) / 60000));
  ```
- **Failed Attempt Penalty**: 20 minutes added for each non-accepted submission made *before* the first solve:
  ```javascript
  penaltyMinutes = acceptedTimeOffsetMin + failedAttemptsBeforeSolve * 20;
  totalPenaltyMinutes += penaltyMinutes;
  ```
- **Post-Solve Submissions**: Any submissions submitted *after* the first accepted solve are ignored for scoring and penalties.

### 4. Partial Scoring for Unsolved Problems
- If a problem is never solved (`!isSolved`), but submissions exist, the participant receives the maximum partial score achieved across those attempts (`bestScore`):
  ```javascript
  else if (subs.length > 0) {
    totalScore += bestScore;
  }
  ```
- Unsolved problems contribute **0** to `totalPenaltyMinutes` and **0** to `solvedProblemsCount`.

### 5. Server-Authoritative Execution
- Scoring is completely server-authoritative. The frontend receives read-only calculated totals and problem chip data (`✓`, `✗`, `—`, solve times, failed attempt counts).

---

## 6. Existing Ranking Logic

ExamForge implements a strict, 5-tier deterministic ranking hierarchy defined in `StandingsService.computeContestStandings` (`backend/src/services/standingsService.js` lines 240–281):

### Deterministic Sorting Hierarchy

1. **Total Score (`totalScore`) DESC**: Participants with higher accumulated contest points rank higher.
2. **Total Penalty Minutes (`totalPenaltyMinutes`) ASC**: Participants with fewer penalty minutes rank higher.
3. **Last Accepted Timestamp (`lastAcceptedAt`) ASC**: Participants who achieved their final solve chronologically earlier rank higher.
4. **Total Execution Time (`totalTimeMs`) ASC**: Participants whose best accepted solutions executed faster rank higher.
5. **Deterministic User ID (`userId`) ASC**: Absolute fallback tie-breaker ensuring reproducible ordering without database nondeterminism.

```javascript
evaluatedParticipants.sort((a, b) => {
  if (b.totalScore !== a.totalScore) {
    return b.totalScore - a.totalScore;
  }
  if (a.totalPenaltyMinutes !== b.totalPenaltyMinutes) {
    return a.totalPenaltyMinutes - b.totalPenaltyMinutes;
  }
  if (a.lastAcceptedAt && b.lastAcceptedAt) {
    const timeDiff = new Date(a.lastAcceptedAt).getTime() - new Date(b.lastAcceptedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
  } else if (a.lastAcceptedAt && !b.lastAcceptedAt) {
    return -1;
  } else if (!a.lastAcceptedAt && b.lastAcceptedAt) {
    return 1;
  }
  if (a.totalTimeMs !== b.totalTimeMs) {
    return a.totalTimeMs - b.totalTimeMs;
  }
  return a.userId - b.userId;
});
```

### Sequential Rank Assignment & Ties
- Ranks are assigned using standard competitive programming tie conventions (1224 ranking):
  - If a participant has identical `totalScore`, `totalPenaltyMinutes`, `lastAcceptedAt`, and `totalTimeMs` to the preceding participant, they receive the **same rank** (`curr.rank = prev.rank`).
  - The next participant receives rank `i + 1` (e.g., if two participants tie for 2nd, the next is 4th).

---

## 7. Submission → Standings Flow

The integration from code submission to visible leaderboard position operates as follows:

1. **Submission Ingestion**:
   - Student calls `POST /api/submissions` with `contestId`, `problemId`, `language`, and `sourceCode`.
   - Record created in `submissions` with `is_sample_run: false`, `status: 'queued'`.
2. **Asynchronous Judge Evaluation**:
   - `judgeQueue` worker picks up the job, builds isolated Docker container, executes test cases.
   - Judge updates row in `submissions`: `status` ('accepted', 'wrong_answer', etc.), `score`, `execution_time`, `memory_used`.
3. **Dynamic Standings Query**:
   - Client polls `GET /api/contests/:id/leaderboard` every 10 seconds (or manual refresh).
   - `StandingsService` executes SQL query:
     ```sql
     SELECT s.id AS "submissionId", s.user_id AS "userId", s.problem_id AS "problemId",
            s.status, s.score, s.execution_time AS "executionTime",
            s.memory_used AS "memoryUsed", s.created_at AS "submittedAt"
     FROM submissions s
     WHERE s.contest_id = $1 AND s.is_sample_run = false
       [AND s.created_at <= $2]
     ORDER BY s.created_at ASC;
     ```
4. **Immediate Visibility**:
   - Because standings are computed dynamically upon each request, there is zero cache invalidation delay. As soon as the judge updates the submission row, the next poll reflects the solve.
5. **Rejudging Impact**:
   - If an admin rejudges a problem or changes a test case, updating `submissions.status` or `submissions.score` immediately updates all standings on the next query.
6. **Failed Execution Handling**:
   - If a submission encounters `compilation_error`, `runtime_error`, `time_limit_exceeded`, or `wrong_answer`, it increments `failedAttemptsBeforeSolve` if prior to solve, correctly adding 20 penalty minutes when solved.

---

## 8. Contest Lifecycle Integration

Contest lifecycle is managed by `getContestRuntimeState` (`backend/src/services/contestService.js`):

| Contest State | Definition Criteria | Leaderboard Behavior | Results Availability |
|---|---|---|---|
| **`draft`** | `status === 'draft'` | **Vulnerability**: `GET /api/contests/:id/leaderboard` does not block draft contests! It returns problems and registered users even if unreleased. | Unreleased. Should be blocked. |
| **`upcoming`** | `status === 'published' && now < startTime` | Returns empty scoreboard or registered students with 0 points. Countdown timer displays time to contest start. | No results yet. |
| **`running`** | `status === 'published' && now >= startTime && now <= endTime` | Live scoreboard updates every 10s. If in freeze window, results are masked at freeze cutoff. | Live provisional results. |
| **`ended`** | `status === 'published' && now > endTime && !is_rating_finalized` | Final live standings visible. Freeze is lifted (unless still waiting on ratings finalization). | Standings available, official rating changes pending finalization. |
| **`archived`** | `status === 'archived'` | Standings and results remain fully preserved and queryable. | Permanent historical results. |

---

## 9. Leaderboard Freeze

Leaderboard freeze mechanics are implemented natively in `StandingsService.computeContestStandings`:

### Configuration
Stored in `contests` table:
- `leaderboard_freeze_enabled BOOLEAN NOT NULL DEFAULT false`
- `leaderboard_freeze_minutes INTEGER NOT NULL DEFAULT 60`

### Freeze Window Determination
```javascript
const freezeMinutes = formattedContest.leaderboardFreezeMinutes || 60;
const freezeTime = new Date(endTime.getTime() - freezeMinutes * 60000);
const isFrozen =
  formattedContest.leaderboardFreezeEnabled &&
  now >= freezeTime &&
  now <= endTime &&
  !formattedContest.isRatingFinalized;
```

### Data Masking Mechanism
- When `isFrozen === true`, non-manager requests append a SQL filter:
  ```sql
  WHERE s.contest_id = $1 AND s.is_sample_run = false AND s.created_at <= $2
  ```
  where `$2` is `freezeTime.toISOString()`.
- **Judge Uninterrupted**: The judge continues executing student submissions normally and storing them in `submissions`.
- **Public Masking**: The public leaderboard only evaluates submissions submitted *before* the freeze time. Submissions made during the freeze window are omitted from the calculation for students and guests.
- **Manager Bypass**:
  ```javascript
  const isManager =
    requestingUser &&
    (requestingUser.role === 'super_admin' ||
      requestingUser.role === 'contest_admin' ||
      (requestingUser.role === 'professor' && requestingUser.id === formattedContest.createdBy));

  const applyFreezeCutoff = isFrozen && !(isManager && freezeOverride);
  ```
  Contest managers and admins passing `?freezeOverride=true` see true, unmasked live standings.
- **Freeze Termination**:
  - Automatically lifts when `now > endTime` or when ratings are finalized (`isRatingFinalized === true`).

---

## 10. Leaderboard Snapshots

ExamForge contains a database table named `leaderboard_snapshots` (`backend/src/database/schema.sql` lines 326–340).

### Key Architectural Discovery:
- **Scope of `leaderboard_snapshots`**: The existing `leaderboard_snapshots` table is **exclusively** for **Platform-Wide Global & College Rating Snapshots** (implemented in Phase 5.6 via `GlobalRankingService.createSnapshot`).
  - Columns: `id`, `snapshot_date`, `scope` ('global'/'college'), `institution`, `user_id`, `rank`, `rating`, `highest_rating`, `rating_status`, `rated_contest_count`.
- **Contest Standings Snapshots**: There is **no table** in the repository for contest-specific leaderboard snapshots or archived scoreboards. Contest standings are always computed on-the-fly from the `submissions` table.

---

## 11. Final Results

ExamForge currently distinguishes the following contest result concepts:

1. **Live Standings**: Dynamic standings computed during an active contest prior to freeze.
2. **Frozen Standings**: Provisional public scoreboard masked at the freeze cutoff time.
3. **Unmasked / Admin Standings**: Authoritative real-time scoreboard accessible only by contest managers via `freezeOverride=true`.
4. **Finalized Results**:
   - Initiated explicitly via `POST /api/contests/:id/finalize-ratings`.
   - Ranks and pairwise Elo rating changes are written permanently to `rating_history`.
   - `contests.is_rating_finalized` is set to `true`, and `ratings_finalized_at` is timestamped.
   - Leaderboard response attaches official `ratingChange` to `userPosition`.

### Current Gaps in Final Results:
- There is no dedicated **Contest Results View** separating finalized contest archives from the live contest scoreboard.
- No contest-level scoreboard snapshot is persisted upon finalization (if submission rows are ever archived or cleaned up, contest standings would shift).

---

## 12. Rating Integration

Rating integration is fully implemented in `RatingService` (`backend/src/services/ratingService.js`):

### Finalization Workflow
1. **Transactional Row Lock**: `SELECT * FROM contests WHERE id = $1 FOR UPDATE` prevents race conditions and concurrent double-finalization.
2. **Pre-Conditions**:
   - Contest must be published (`contest.status === 'published'`).
   - Contest must be rated (`contest.is_rated === true`).
   - Contest runtime state must be `'ended'` (unless bypassed by `options.force === true`).
3. **Idempotency**:
   - If `contest.is_rating_finalized === true`, the transaction commits immediately and returns the existing rows from `rating_history` without recalculating.
4. **Standings Computation**:
   - Calls `StandingsService.computeContestStandings({ contestId, limit: 10000, freezeOverride: true })`.
5. **Multi-Participant Elo Calculation**:
   - Evaluates pairwise win/loss/tie outcomes:
     $$\text{Win: } p.\text{rank} < \text{opponent}.\text{rank} \implies 1.0$$
     $$\text{Tie: } p.\text{rank} == \text{opponent}.\text{rank} \implies 0.5$$
     $$\text{Loss: } p.\text{rank} > \text{opponent}.\text{rank} \implies 0.0$$
   - Expected score: $E_{ij} = \frac{1}{1 + 10^{(R_j - R_i) / 400}}$
   - Normalized delta: $\Delta R = \text{round}\left( \frac{K}{N-1} \sum (S_{ij} - E_{ij}) \right)$
   - $K$-Factor: 32 for provisional players ($< 5$ contests), 16 for rated players.
6. **Persistence**:
   - Updates `users.current_rating`, `users.highest_rating`, `users.rating_status`, `users.rated_contest_count`.
   - Inserts record into `rating_history(user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count, performance_rating)`.
   - Updates `contests SET is_rating_finalized = true, ratings_finalized_at = CURRENT_TIMESTAMP`.
   - Records persistent audit log `RATINGS_FINALIZED`.

---

## 13. Participant Integration

Participant integration is grounded in the `contest_participants` table:

### Table Schema
```sql
CREATE TABLE contest_participants (
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, user_id)
);
```

### Participation Behaviors:
- **Registered Participants**: Any student in `contest_participants` with `u.role = 'student'` is fetched and included in the standings.
- **Zero-Submission Participants**: Students who joined but never submitted are retained in `allParticipants`. They receive `totalScore: 0`, `totalPenaltyMinutes: 0`, `solvedProblemsCount: 0`, and `lastAcceptedAt: null`. They appear at the bottom of the scoreboard ranked according to the deterministic tie-breaker.
- **Removed Participants**: When a participant is removed via `DELETE FROM contest_participants WHERE contest_id = $1 AND user_id = $2`, they are excluded from all subsequent standings calculations.
- **Participant Status**: The `contest_participants` table currently does **not** have a `status` column (such as `registered`, `active`, `disqualified`, `withdrawn`). All rows in `contest_participants` are considered active participants.

---

## 14. Authorization & RBAC

The following access matrix is enforced by backend controllers and middleware:

| Role | Leaderboard Access | Frozen Leaderboard | Rating Finalization | Management Controls |
|---|---|---|---|---|
| **Anonymous / Guest** | `GET /:id/leaderboard` (Public) | Sees frozen masked standings | Forbidden (401) | None |
| **Student** | `GET /:id/leaderboard` | Sees frozen masked standings; `freezeOverride` query ignored | Forbidden (403) | View personal rank & rating delta |
| **Professor (Creator)** | `GET /:id/leaderboard` | Can view live unmasked standings via `freezeOverride=true` | Permitted (`POST /:id/finalize-ratings`) | Full contest ownership controls |
| **Professor (Non-Owner)** | `GET /:id/leaderboard` | Sees frozen masked standings; `freezeOverride` denied | Forbidden (403) | None |
| **Contest Admin** | `GET /:id/leaderboard` | Can view live unmasked standings via `freezeOverride=true` | Permitted on all contests | Full administrative controls |
| **Super Admin** | `GET /:id/leaderboard` | Can view live unmasked standings via `freezeOverride=true` | Permitted on all contests | Global administrative controls |

---

## 15. Security / BOLA Analysis

A thorough audit of `backend/src/routes/contestRoutes.js` and `backend/src/services/standingsService.js` identified the following security findings:

### 1. HIGH VULNERABILITY: Draft Contest Leaderboard Exposure (BOLA / IDOR)
- **Location**: `backend/src/routes/contestRoutes.js` line 25 & `backend/src/services/standingsService.js` lines 36–42.
- **Mechanism**:
  - `GET /api/contests/:id/leaderboard` uses `optionalAuthenticate`.
  - `StandingsService.computeContestStandings` checks `if (!contest) throw 404`, but **does not check** `contest.status === 'published'`.
  - If a professor creates a contest in `'draft'` mode, any unauthenticated user or student who knows or guesses the numeric contest ID can query `GET /api/contests/:id/leaderboard`.
- **Impact**: Leaks contest problem titles, IDs, max points, and problem order of unreleased/confidential examinations or upcoming competitive contests.
- **Remediation Needed**: If `contest.status === 'draft'`, verify that `requestingUser` is an authorized manager (`super_admin`, `contest_admin`, or contest creator); otherwise return `404 Not Found` or `403 Forbidden`.

### 2. Private / Restricted Contest Standings Access
- **Mechanism**: Contest enrollment and access validation (`contestAccessService`) restricts student entry to private or code-protected contests. However, `GET /api/contests/:id/leaderboard` does not currently check if a contest is private or requires registration before returning the scoreboard.
- **Remediation Needed**: Enforce consistency with contest visibility rules.

### 3. Freeze Parameter Tampering Prevention (VERIFIED SECURE)
- **Mechanism**: The parameter `freezeOverride=true` is checked against `isManager`:
  ```javascript
  const isManager = requestingUser && (requestingUser.role === 'super_admin' || requestingUser.role === 'contest_admin' || (requestingUser.role === 'professor' && requestingUser.id === formattedContest.createdBy));
  ```
  Students passing `?freezeOverride=true` are strictly ignored and receive frozen scores.

### 4. Score Manipulation & Injection Prevention (VERIFIED SECURE)
- Standings are derived solely from internal database queries; user input cannot alter point values, rankings, or tie-breakers.

---

## 16. Frontend/UI Architecture

### Student Contest Leaderboard (`ContestLeaderboard.jsx`)
The existing component `frontend/src/components/ContestLeaderboard.jsx` is highly mature, visually polished, and fully functional:
- **Header Section**: Contest title, runtime state badge (`Finalized`, `Frozen`, `Live`, `Upcoming`, `Ended`), rated contest pill, live countdown clock, live auto-refresh toggle (10s interval), manual refresh button.
- **Freeze Alert Banner**: Prominent banner explaining that ranking is frozen while judging continues.
- **Top-3 Podium Section**: Dynamic Gold 🥇, Silver 🥈, Bronze 🥉 cards showing coder avatar/emblem, rating tier color, score, and problems solved.
- **Sticky Current User Position Banner**: Displays logged-in student's real-time rank (`#N`), solved problem count, points, penalty, and post-contest rating delta (`+45`).
- **Filter Toolbar**: Instant search by username or full name, with quick summary badges (participants, problems, top score).
- **Problem-by-Problem Scoreboard Matrix**:
  - Columns: Rank `#`, Coder (avatar, username, handle, tier), Total Score, Total Penalty, followed by Problem columns (`P1`, `P2`, `...`).
  - Problem cells render interactive chips:
    - `✓ +N` in green with solve time in minutes (`chip-solved`).
    - `✗ -N` in red with failed attempt count (`chip-failed`).
    - `—` in gray for unattempted (`chip-unattempted`).
- **Pagination Bar**: Prev/Next controls with total counts.

### Admin Contest Management UI (`AdminContestManagement.jsx`)
- The admin dashboard features an inspection drawer with tabs for:
  1. `problems` (`AdminContestProblemList.jsx`)
  2. `participants` (`AdminContestParticipantList.jsx`)
- **Current UI Gap**:
  - The drawer only contains an external link: `<a href="/contests/:id/leaderboard" target="_blank">Open Standings</a>`.
  - There is **no dedicated admin leaderboard tab** inside the drawer.
  - There is **no freeze override toggle switch** for admins within the dashboard.
  - There is **no rating finalization button** or modal in the admin UI to trigger `POST /api/contests/:id/finalize-ratings`.
  - There is **no CSV/JSON export button** for exporting contest standings.

---

## 17. Database Architecture

The following tables constitute the leaderboard and results data layer:

### 1. `contests`
- `id` (PK, SERIAL)
- `leaderboard_freeze_enabled` (BOOLEAN, DEFAULT false)
- `leaderboard_freeze_minutes` (INTEGER, DEFAULT 60)
- `is_rating_finalized` (BOOLEAN, DEFAULT false)
- `ratings_finalized_at` (TIMESTAMP WITH TIME ZONE)

### 2. `contest_problems`
- `contest_id` (FK $\rightarrow$ `contests.id`, ON DELETE CASCADE)
- `problem_id` (FK $\rightarrow$ `problems.id`, ON DELETE CASCADE)
- `problem_order` (INTEGER, DEFAULT 1)
- `points` (INTEGER, DEFAULT 100)
- PRIMARY KEY: `(contest_id, problem_id)`
- Indexes: `idx_contest_problems_contest`, `idx_contest_problems_problem`

### 3. `contest_participants`
- `contest_id` (FK $\rightarrow$ `contests.id`, ON DELETE CASCADE)
- `user_id` (FK $\rightarrow$ `users.id`, ON DELETE CASCADE)
- `joined_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- PRIMARY KEY: `(contest_id, user_id)`
- Indexes: `idx_contest_participants_contest`, `idx_contest_participants_user`

### 4. `submissions`
- `id` (PK, SERIAL)
- `user_id` (FK $\rightarrow$ `users.id`, ON DELETE CASCADE)
- `contest_id` (FK $\rightarrow$ `contests.id`, ON DELETE RESTRICT)
- `problem_id` (FK $\rightarrow$ `problems.id`, ON DELETE RESTRICT)
- `status` (VARCHAR(30))
- `score` (INTEGER, DEFAULT 0)
- `execution_time` (INTEGER, DEFAULT 0)
- `memory_used` (INTEGER, DEFAULT 0)
- `is_sample_run` (BOOLEAN, DEFAULT false)
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- Indexes: `idx_submissions_user_id`, `idx_submissions_contest_id`, `idx_submissions_problem_id`

### 5. `rating_history`
- `id` (PK, SERIAL)
- `user_id` (FK $\rightarrow$ `users.id`, ON DELETE CASCADE)
- `contest_id` (FK $\rightarrow$ `contests.id`, ON DELETE CASCADE)
- `previous_rating` (INTEGER)
- `rating_change` (INTEGER)
- `new_rating` (INTEGER)
- `rank` (INTEGER)
- `participant_count` (INTEGER)
- `performance_rating` (INTEGER, DEFAULT 1200)
- `rating_status` (VARCHAR(20), DEFAULT 'provisional')
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT CURRENT_TIMESTAMP)
- Unique Constraint: `uq_rating_history_user_contest UNIQUE (user_id, contest_id)`
- Indexes: `idx_rating_history_user_id`, `idx_rating_history_contest_id`, `idx_rating_history_created_at`

### 6. `leaderboard_snapshots`
- Dedicated to platform rating history (`scope`, `institution`, `snapshot_date`, `user_id`, `rank`, `rating`).
- Does **not** store contest standings.

---

## 18. Performance Observations

ExamForge targets approximately **1,000 concurrent users**. The following performance observations and architectural bottlenecks were identified:

1. **Repeated In-Memory Aggregation**:
   - `StandingsService.computeContestStandings` loads all contest submissions (`SELECT ... FROM submissions WHERE contest_id = $1`) and all registered participants on every request.
   - For 1,000 active students refreshing every 10 seconds, this produces 100 queries/second scanning thousands of submission rows and performing in-memory mapping and sorting in JavaScript.
2. **Missing Composite Index on Submissions**:
   - The query uses `WHERE s.contest_id = $1 AND s.is_sample_run = false [AND s.created_at <= $2] ORDER BY s.created_at ASC`.
   - Existing indexes: `idx_submissions_contest_id ON submissions(contest_id)`.
   - Missing Index: A composite index `CREATE INDEX idx_submissions_contest_run_created ON submissions(contest_id, is_sample_run, created_at)` would allow PostgreSQL to perform an index-only or tight index scan without separate filtering and sorting.
3. **In-Memory Pagination**:
   - Standings pagination is currently performed in Node.js via `filteredParticipants.slice(offset, offset + limit)`.
   - While necessary for ranking and tie-breaking across all participants, precomputing or caching standings for 5–10 seconds during high concurrency would significantly alleviate database load without stale data risks.

---

## 19. Existing Tests

| Test Suite File | Focus Area | Number of Tests / Steps | Current Execution Status |
|---|---|---|---|
| `frontend/test_phase5_5.js` | Full Contest Leaderboard, Submissions, ICPC Scoring, Problem Matrix, Freeze Masking, Manager Bypass, Rating Finalization, Idempotency | 36 automated assertions | **ALL 36 PASSED** |
| `backend/test_admin_phase5_5_9_scoring_consistency.js` | Contest Problem Points (`cp.points`), Standings Consistency, Judge Evaluation Dynamic Points, Lifecycle Locks | 15 test categories | **ALL PASSED** |
| `backend/test_public_practice_submission_context.js` | Separation of public practice submissions from contest standings | Integration tests | **ALL PASSED** |
| `backend/test_admin_phase5_5_5_problem_ordering.js` | Contest problem sequencing and ordering integrity | Problem ordering tests | **ALL PASSED** |
| `backend/test_admin_phase5_5_6_bulk_ordering.js` | Bulk reordering of contest problems preserving score mapping | Bulk ordering tests | **ALL PASSED** |

---

## 20. Existing Functionality

The following components and services are **fully implemented, tested, and reusable**:

1. **Authoritative Standings Service (`StandingsService.computeContestStandings`)**:
   - Dynamic ICPC scoring with configurable problem points.
   - Penalty calculation (solve time + 20 min per wrong attempt prior to AC).
   - Strict 5-tier deterministic tie-breaking.
   - Sequential rank assignment (1224 convention).
   - Top-3 podium extraction and current user position identification.
   - Search filtering (username, full name) and server-side pagination.
   - Summary statistics (top, average, median score).
2. **Leaderboard Freeze Engine**:
   - Time-window detection (`freezeTime = endTime - freezeMinutes`).
   - Query-level submission cutoff masking.
   - Role-based manager bypass via `freezeOverride=true`.
3. **Multi-Participant Elo Rating Engine (`RatingService`)**:
   - Transactional, idempotent rating finalization.
   - Pairwise multi-participant Elo calculation with provisional/rated K-factor scaling.
   - Atomic persistence to `rating_history` and `users`.
4. **Student Leaderboard Interface (`ContestLeaderboard.jsx`)**:
   - Live countdown timer, 10s auto-refresh toggle, freeze alert banner.
   - Top-3 podium (Gold/Silver/Bronze), sticky user position card with rating delta.
   - Problem-by-problem matrix table with visual solve chips (`✓`, `✗`, `—`).

---

## 21. Partial Functionality

The following features exist but are incomplete or lack full integration:

1. **Admin Standings Inspection**:
   - Admins can view standings only by opening the public leaderboard URL in a new browser tab. There is no integrated admin scoreboard tab in `AdminContestManagement.jsx`.
2. **Final Results Presentation**:
   - The platform relies on the same live scoreboard view for finalized contests. There is no specialized "Contest Concluded / Final Results" summary view highlighting winners, problem solve statistics, and rating adjustments.
3. **Contest Snapshot Architecture**:
   - `leaderboard_snapshots` exists for global ratings, but no snapshot mechanism exists for preserving static contest scoreboards upon finalization.

---

## 22. Missing Functionality

The following features are required for Phase 7.5.8 but are **not currently implemented**:

1. **BOLA Protection on Draft Contests**:
   - Verification in `GET /api/contests/:id/leaderboard` to reject non-manager requests for draft contests.
2. **Admin Leaderboard Tab & Controls**:
   - An embedded `Standings` tab inside the contest inspection drawer in `AdminContestManagement.jsx`.
   - A toggle switch for admins to view live unmasked standings vs. frozen standings (`freezeOverride`).
   - An action button to trigger contest rating finalization with confirmation modal.
3. **Standings Export API & UI**:
   - Endpoint `GET /api/contests/:id/leaderboard/export?format=csv|json` for downloading authoritative contest results.
   - "Export Results (CSV)" button in the admin interface.
4. **Contest Results / Awards Summary View**:
   - Post-contest celebration view showcasing final standings, participant performance cards, solve rate distributions, and rating adjustments.

---

## 23. Security / Integrity Gaps

1. **Draft Contest Information Leak**:
   - `GET /api/contests/:id/leaderboard` does not inspect `contest.status`. Any caller can inspect problems and participants of unreleased draft contests.
2. **Private Contest Standings Leak**:
   - Private contests do not check user enrollment or access permissions before returning the leaderboard.
3. **Composite Database Index Missing**:
   - High concurrent submission query load on `submissions(contest_id, is_sample_run, created_at)` could cause degraded response times during contest conclusion or unfreeze.

---

## 24. Testing Gaps

1. **Draft Contest Security Tests**:
   - No automated tests currently verify that students and anonymous callers are rejected when requesting the leaderboard of a draft contest.
2. **Admin Leaderboard UI Tests**:
   - No automated frontend test suites exist for admin freeze override toggles, rating finalization triggers, or export operations.
3. **Export Endpoint Verification**:
   - No tests currently validate CSV/JSON export generation or header formatting.

---

## 25. Recommended Phase 7.5.8 Roadmap

Based strictly on this audit, the recommended implementation sequence for Phase 7.5.8 is:

### Sub-Phase 7.5.8.2 — Contest Results View
- **Objective**: Create a dedicated post-contest results view for concluded and finalized contests.
- **Backend**: Reuse `StandingsService.computeContestStandings`. Ensure finalized contests deliver official ranks and rating deltas.
- **Frontend**: Add a results view displaying podium winners, contest performance badges, and official rating adjustments.

### Sub-Phase 7.5.8.3 — Admin Leaderboard
- **Objective**: Embed an authoritative contest leaderboard inside `AdminContestManagement.jsx`.
- **Backend**: Add manager-specific standings query options (unfiltered submissions, unmasked freeze).
- **Frontend**: Add `Standings` tab in the contest inspection drawer with live/frozen toggle (`freezeOverride`).

### Sub-Phase 7.5.8.4 — Result Details
- **Objective**: Enable detailed problem-level inspection of participant submissions from the leaderboard.
- **Backend**: Ensure problem matrix provides accurate execution time, penalty breakdown, and attempt count.
- **Frontend**: Expandable row or modal displaying submission timestamps and attempt history.

### Sub-Phase 7.5.8.5 — Freeze & Final Results
- **Objective**: Formalize the transition from frozen state to final results in the admin UI.
- **Backend**: Connect `finalizeContestRatings` to admin UI actions with audit logging.
- **Frontend**: Add a "Finalize Contest & Apply Ratings" button with confirmation modal in the admin inspection drawer.

### Sub-Phase 7.5.8.6 — Export & Reporting
- **Objective**: Implement CSV/JSON export for contest standings and results.
- **Backend**: Add `GET /api/contests/:id/leaderboard/export` returning formatted CSV or JSON.
- **Frontend**: Add "Export CSV" and "Export JSON" buttons to both Admin Leaderboard and Student Results view.

### Sub-Phase 7.5.8.7 — Security & Integrity
- **Objective**: Fix BOLA vulnerabilities and harden leaderboard access.
- **Backend**: Block draft contest leaderboard queries for non-managers. Enforce private contest visibility.
- **Database**: Add composite index on `submissions(contest_id, is_sample_run, created_at)`.

### Sub-Phase 7.5.8.8 — Testing & Regression
- **Objective**: Comprehensive test coverage across all leaderboard features and security fixes.
- **Tests**: Automated tests for draft protection, admin freeze toggle, export formatting, and concurrent standings calculation.

### Sub-Phase 7.5.8.9 — Integration & Completion
- **Objective**: End-to-end verification and sign-off for Phase 7.5.8.

---

## 26. Out of Scope

The following items are **STRICTLY OUT OF SCOPE** for Phase 7.5.8:
- Rebuilding `StandingsService.js` (existing service is robust and proven).
- Rewriting scoring or ICPC penalty calculation logic.
- Rewriting `RatingService.js` or the Multi-Participant Elo algorithm.
- Modifying contest lifecycle state machines or enrollment rules.
- Introducing Redis caching, materialized views, or external queue infrastructure.
- Redesigning the existing student `ContestLeaderboard.jsx` component.

---

## 27. Audit Conclusion

The existing ExamForge leaderboard and results architecture is fundamentally robust, mathematically sound, and feature-rich. The core engine (`StandingsService.js`) already provides complete ICPC scoring, penalty calculations, deterministic 5-tier tie-breaking, freeze cutoff filtering, and multi-participant Elo rating finalization. The student-facing UI (`ContestLeaderboard.jsx`) is complete with podiums, countdown timers, and problem matrices.

The primary gaps for Phase 7.5.8 are:
1. Resolving the draft contest BOLA vulnerability in `GET /api/contests/:id/leaderboard`.
2. Providing dedicated admin management controls (embedded inspection tab, freeze toggle, rating finalization action) inside `AdminContestManagement.jsx`.
3. Adding a CSV/JSON standings export endpoint and UI trigger.
4. Adding a composite database index to optimize submission scanning for 1,000 concurrent users.

Phase 7.5.8 can be implemented cleanly and efficiently by building directly upon the existing codebase without rewriting core logic.
