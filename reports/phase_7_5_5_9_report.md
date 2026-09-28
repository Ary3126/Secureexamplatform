# Phase 7.5.5.9 Report

## Phase
7.5.5.9 Contest Problem Configuration & Scoring Consistency

## Goal
Ensure contest problem configuration remains consistent across:
Admin Configuration → Contest Problem Relationship → Submission Evaluation → Leaderboard / Standings → Rating / Result Calculations.
A problem attached to a contest must have a deterministic and valid configuration across all contest states.

---

## Existing Configuration Model
- **`contest_problems` Relationship Schema**:
  - `contest_id` (`INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE`)
  - `problem_id` (`INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE`)
  - `points` (`INTEGER NOT NULL DEFAULT 100 CHECK (points > 0)`)
  - `problem_order` (`INTEGER NOT NULL DEFAULT 1 CHECK (problem_order > 0)`)
  - `created_at` (`TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`)
  - Primary Key: `(contest_id, problem_id)`
- **Catalog Problems**:
  - `problems` table stores immutable problem metadata: `title`, `description`, `difficulty`, `coding_mode` (`function` vs `full_program`), `access_scope`, and test case suites.
- **Standings Computation**:
  - `StandingsService.computeContestStandings(contestId)` joins `contest_problems cp` on `cp.problem_id = p.id AND cp.contest_id = $1`, reading `cp.points AS "maxPoints"` and accumulating `totalScore += prob.maxPoints` upon solving each problem.
- **Submission Evaluation**:
  - `judgeQueue.js` processes queued submissions, invokes `JudgeService.evaluateSubmission`, and persists `score` to table `submissions`.

---

## Audit Findings
1. **Critical Scoring Disconnect in Judge Queue**:
   - `backend/src/judge/queue/judgeQueue.js` previously hardcoded `problemPoints: 100` for all submissions (`const evaluationResult = await JudgeService.evaluateSubmission(..., { problemPoints: 100, ... })`).
   - Consequently, when a contest problem was attached with custom points (e.g., 250, 400 pts), individual submissions in `submissions` were recorded with a maximum score of 100 instead of the contest problem's configured points.
2. **Missing Helper in Contest Model**:
   - There was no targeted helper method on `ContestModel` to query the configured points of a specific problem within a contest for execution pipelines.
3. **Points Validation Boundaries**:
   - Points validation in `backend/src/middleware/contestValidation.js` accepted decimal numbers (e.g. `100.5`) because it checked `!Number.isNaN(Number(points)) && Number(points) > 0` without validating `Number.isInteger(...)` and without an upper boundary ceiling.
4. **Frontend Input Alignment**:
   - `frontend/src/components/admin/AdminContestProblemList.jsx` lacked client-side integer and bounds checking in `handleAddProblemSubmit`, and input ceiling was set to 10,000 rather than aligning with backend boundaries (100,000).

---

## Implemented Changes

### 1. Dynamic Contest Problem Points Resolution in Judge Queue
- Modified `backend/src/judge/queue/judgeQueue.js`:
  - Imported `ContestModel`.
  - When `submission.contestId` is present on the job, dynamically resolved the problem's configured points from `contest_problems` via `ContestModel.getContestProblemPoints(submission.contestId, submission.problemId)`.
  - Passed the authoritative points value to `JudgeService.evaluateSubmission({ problemPoints: configuredPoints, ... })`.

### 2. Contest Model Helper
- Modified `backend/src/models/contestModel.js`:
  - Implemented `ContestModel.getContestProblemPoints(contestId, problemId)`:
    - Queries `contest_problems` for `points WHERE contest_id = $1 AND problem_id = $2`.
    - Falls back safely to default 100 if no contest mapping is found or if points are omitted.

### 3. Backend Validation Hardening
- Modified `backend/src/middleware/contestValidation.js`:
  - In `validateAddProblemToContest`:
    - Validates points: must be an integer between 1 and 100,000 (`Number.isInteger(numPoints) && numPoints >= 1 && numPoints <= 100000`).
    - Explicitly rejects decimals, floats, negative values, zero, strings with non-digit characters, NaN, and Infinity.
  - In `validateBulkAddContestProblems`:
    - Applies identical integer and range validation ($1 \dots 100,000$) to all elements in `problems` array.
- Modified `backend/src/controllers/contestController.js`:
  - Hardened points parsing and validation in `addProblemToContest` and `bulkAddProblemsToContest` as defense-in-depth against bypassed validation.

### 4. Frontend UI Alignment
- Modified `frontend/src/components/admin/AdminContestProblemList.jsx`:
  - Updated `handleAddProblemSubmit` to validate `Number.isInteger(parsedPts) && parsedPts > 0 && parsedPts <= 100000`.
  - Updated Points input field: `min="1"` and `max="100000"`.

---

## Files Changed
- `backend/src/models/contestModel.js` (Added `getContestProblemPoints`)
- `backend/src/judge/queue/judgeQueue.js` (Integrated dynamic contest problem points lookup)
- `backend/src/middleware/contestValidation.js` (Hardened points validation for single and bulk add)
- `backend/src/controllers/contestController.js` (Hardened controller points handling)
- `frontend/src/components/admin/AdminContestProblemList.jsx` (Client-side bounds validation and input attributes)

---

## Database Changes
- **None required**.
- Existing PostgreSQL schema already enforces:
  - `CHECK (points > 0)` and `INTEGER` column type on `contest_problems.points`.
  - `CHECK (problem_order > 0)` on `contest_problems.problem_order`.
  - Primary Key `(contest_id, problem_id)` preventing duplicates.
  - Foreign keys with `ON DELETE CASCADE`.

---

## Points / Scoring Validation
- **Default Points**: 100 (applied when omitted or null).
- **Explicit Points**: Integer values from 1 to 100,000.
- **Rejected Values**:
  - 0 (rejected: "points must be an integer between 1 and 100000")
  - Negative values (e.g., `-50`)
  - Decimals / Floats (e.g., `100.5`, `99.99`)
  - Out of bounds (e.g., `100001`, `150000`)
  - Non-numeric / NaN / Infinity / string literals (e.g., `'abc'`)

---

## Problem Metadata Validation
- Adding a problem to a contest does not modify the underlying problem in `problems`:
  - `title`, `description`, `difficulty`, `coding_mode`, `access_scope`, and test cases remain byte-for-byte identical.
  - Function mode starter templates and test harnesses are preserved.
  - Full program test cases remain intact.

---

## Add / Remove Consistency
- **Add Problem**:
  - Inserts mapping row into `contest_problems` with configured points and next contiguous `problem_order`.
  - Does not modify any other contest fields or problem records.
- **Remove Problem**:
  - Deletes only the `contest_problems` mapping row.
  - Underlying problem in `problems`, its test cases, submissions, participants, and contest configuration remain completely intact.

---

## Ordering Consistency
- **Single Reorder & Bulk Reorder**:
  - Reordering modifies solely `contest_problems.problem_order`.
  - Reordering does NOT modify:
    - Problem points (`points` column)
    - Problem content, difficulty, or coding mode
    - Problem ownership or creator
    - Submissions
    - Contest participants
    - Rating configuration

---

## Contest Edit Interaction
- `ContestModel.updateContestWithSafety` operates strictly on the `contests` table:
  - Editing contest metadata (`title`, `description`, `startTime`, `endTime`, `isRated`, `leaderboardFreezeMinutes`) does not modify `contest_problems`.
  - Attached problems, problem ordering, and configured points are 100% preserved.
- Problem mutations (`add`, `remove`, `reorder`) do not overwrite or reset contest metadata fields.

---

## Leaderboard Consistency
- `StandingsService.computeContestStandings` queries `cp.points AS "maxPoints"` from `contest_problems`.
- Each participant's `totalScore` accumulates the exact `maxPoints` configured for each solved problem.
- Submission `score` recorded by the judge pipeline matches `cp.points`.
- Leaderboard freeze and tie-breaking correctly respect authoritative points and penalty times.

---

## Rating Interaction
- `RatingService.finalizeContestRatings(contestId)` consumes the final leaderboard ranks computed by `StandingsService.computeContestStandings(contestId)`.
- Ranks are determined by `totalScore` (which is driven by problem points) and penalty time.
- Therefore, contest problem points authoritatively influence ratings via participant rank determination.
- Rating formulas (Elo/Glicko-based rating changes) operate on ranks and remain completely independent and unchanged.

---

## Security Testing
- **RBAC**:
  - Only authorized roles (`super_admin`, `contest_admin`, and owner `professor`) can configure or modify contest problems.
  - Non-owner professors and students receive `403 Forbidden`.
  - Unauthenticated requests receive `401 Unauthorized`.
- **BOLA / Eligibility Protection**:
  - Attaching another professor's private problem returns `403 Forbidden`.
- **Contest Lifecycle Locks**:
  - Running, ended, and archived contests strictly reject problem additions, removals, and reordering with `409 Conflict`.
- **Transaction Rollback Integrity**:
  - Any failure during reorder or mutation rolls back the database transaction completely, preserving existing points and ordering byte-for-byte.

---

## Tests Added
1. **`backend/test_admin_phase5_5_9_scoring_consistency.js`** (46 test cases):
   - Default points assignment (100)
   - Explicit points assignment (e.g. 50, 250, 400, 100,000)
   - Rejection of invalid points (0, negative, decimals, NaN, Infinity, > 100,000)
   - Duplicate configuration rejection (409 Conflict)
   - Add/Remove consistency preserving problem records
   - Reordering preserving individual problem points
   - Bulk reordering preserving points across all problems
   - Contest edit preserving attached problems, ordering, and points
   - Leaderboard scoring consistency with configured points
   - Dynamic judge queue points evaluation
   - Problem metadata and coding mode preservation
   - Lifecycle lock rejection on running contests
   - RBAC and BOLA protection
   - Transaction rollback on simulated reorder failure
2. **`frontend/test_admin_phase5_5_9_scoring_consistency_ui.js`** (23 test cases):
   - Points badge display on rows and fallback to default 100
   - Total points tally computation across attached problems
   - Client points input validation (1 to 100,000 integer check)
   - Ordering sequence badge display (#1, #2, #3)
   - Metadata display (title, ID, difficulty badges, codingMode label)
   - Extraction and rendering of backend 400, 403, 409, 422 errors
   - Refresh after Add, Remove, and Reorder mutations
   - Prevention of stale scoring state
   - Lifecycle locked contest button disabling, tooltips, and warning banner

---

## Test Results
- **Backend Tests (`backend/test_admin_phase5_5_9_scoring_consistency.js`)**:
  - **46 / 46 PASSED** (0 failed)
- **Frontend Tests (`frontend/test_admin_phase5_5_9_scoring_consistency_ui.js`)**:
  - **23 / 23 PASSED** (0 failed)

---

## Regression Results
| Test Suite | Result | Details |
| :--- | :--- | :--- |
| Phase 7.5.5.8 Backend (`test_admin_phase5_5_8_contest_problem_integrity.js`) | **PASS** | 55 / 55 passed |
| Phase 7.5.5.8 Frontend (`test_admin_phase5_5_8_contest_problem_integrity_ui.js`) | **PASS** | 29 / 29 passed |
| Phase 7.5.5.7 Backend (`test_admin_phase5_5_7_lifecycle_lock_enforcement.js`) | **PASS** | 58 / 58 passed |
| Phase 7.5.5.7 Frontend (`test_admin_phase5_5_7_lifecycle_lock_ui.js`) | **PASS** | 28 / 28 passed |
| Phase 7.5.5.6 Backend (`test_admin_phase5_5_6_bulk_ordering.js`) | **PASS** | 36 / 36 passed |
| Phase 7.5.5.6 Frontend (`test_admin_phase5_5_6_bulk_ordering_ui.js`) | **PASS** | 17 / 17 passed |
| Phase 7.5.5.5 Backend (`test_admin_phase5_5_5_problem_ordering.js`) | **PASS** | 34 / 34 passed |
| Phase 7.5.5.5 Frontend (`test_admin_phase5_5_5_problem_ordering_ui.js`) | **PASS** | 25 / 25 passed |
| Phase 7.5.5.4 Backend (`test_admin_phase5_5_4_remove_problem.js`) | **PASS** | 31 / 31 passed |
| Phase 7.5.5.4 Frontend (`test_admin_phase5_5_4_remove_problem_ui.js`) | **PASS** | 31 / 31 passed |
| Phase 7.5.5.3 Backend (`test_admin_phase5_5_3_add_problem.js`) | **PASS** | 42 / 42 passed |
| Phase 7.5.5.3 Frontend (`test_admin_phase5_5_3_add_problem_ui.js`) | **PASS** | 24 / 24 passed |
| Phase 7.5.5.2 Backend (`test_admin_phase5_5_2_contest_problem_list.js`) | **PASS** | 31 / 31 passed |
| Phase 7.5.4 Frontend (`test_admin_phase7_5_4_edit_contest_ui.js`) | **PASS** | 51 / 51 passed |
| Phase 7.5.3 Backend (`test_admin_phase5_3_create_contest.js`) | **PASS** | 66 / 66 passed |
| Phase 7.5.3 Frontend (`test_admin_phase5_3_create_contest_ui.js`) | **PASS** | 22 / 22 passed |
| Deletion Safety (`test_phase5_9_2_2_deletion_safety.js`) | **PASS** | 23 / 23 passed |
| Contest Lifecycle Locks (`test_phase5_9_2_4_contest_lifecycle_locks.js`) | **PASS** | 26 / 26 passed |
| Contest Problem Locks (`test_phase5_9_2_5_contest_problem_locks.js`) | **PASS** | 31 / 31 passed |
| API Security & Rate Limiting (`test_phase_api_security.js`) | **PASS** | 13 / 13 passed |
| Phase 3 Contest Regression (`test_phase3.js`) | **PASS** | 32 / 32 passed |
| Phase 2 Auth & Profile (`test_phase2.js`) | **PASS** | 28 / 28 passed |
| Phase 4b3 Edge/Boundary Judge (`test_phase4b3.js`) | **PASS** | 29 / 29 passed |
| Admin Dashboard API (`test_admin_phase2_dashboard_api.js`) | **PASS** | 5 / 5 passed |
| Admin Users API (`test_admin_phase3_users_api.js`) | **PASS** | 56 / 56 passed |
| Admin Problems Architecture (`test_admin_phase4_1_problems_architecture.js`) | **PASS** | 30 / 30 passed |
| Admin Contest List (`test_admin_phase5_2_contest_list.js`) | **PASS** | 74 / 74 passed |

---

## Build Verification
- `npm run build` executed in `frontend/`:
  - Built cleanly in 1.60s without errors.
  - Output bundle: `dist/index.html`, `dist/assets/index-CZH9Z1f5.css` (236.75 kB), `dist/assets/index-BLl-NfRQ.js` (922.89 kB).

---

## Startup / Health Verification
- CodeForge backend server started and tested.
- `GET /api/health` returned:
  - HTTP Status: `200 OK`
  - Response Body: `{"server":"OK","database":"OK"}`
- PostgreSQL database connection verified and graceful pool termination confirmed.

---

## Known Issues
- None.

---

## Performance Notes
- Dynamic points resolution in `judgeQueue.js` queries `contest_problems` via primary key `(contest_id, problem_id)`. The lookup execution time is < 1ms, adding negligible overhead to submission evaluation.

---

## Final Status
**COMPLETE & VERIFIED**. Phase 7.5.5.9 is fully implemented, verified, and adheres to all architectural constraints, RBAC requirements, and minimal-change guidelines.
