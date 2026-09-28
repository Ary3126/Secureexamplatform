# Phase 7.5.5.4 — Remove Problem from Contest

## Phase
Phase 7.5.5.4 — Remove Problem from Contest (Sub-phase of Phase 7.5.5: Contest Problems / Ordering)

## Goal
Implement the ability for authorized contest managers (`super_admin`, `contest_admin`, and owner `professor`) to remove an existing attached problem from an existing contest.
Crucially, removing a problem removes **only the relationship** between the contest and the problem in the `contest_problems` join table. It **must never delete** the underlying problem from the `problems` table or alter its test cases, submissions, participants, or rating records.

## Audit Findings
- **Endpoint**: Existing route `DELETE /api/contests/:contestId/problems/:problemId` was declared in `backend/src/routes/contestRoutes.js` routing to `contestController.removeProblemFromContest`.
- **Controller**: Controller method required hardening for positive integer parameter validation (`400 Bad Request`), problem catalog existence verification (`404 Not Found`), ownership verification before lifecycle check (`403 Forbidden` with audit log), authoritative lifecycle lock verification (`409 Conflict`), and structured success response (`200 OK`).
- **Model**: `ContestModel.removeProblemFromContestWithSafety` was already present in `backend/src/models/contestModel.js`, performing transactional row-level locking (`SELECT ... FOR UPDATE`), runtime lifecycle state check, deletion strictly from `contest_problems`, and transactional audit logging (`CONTEST_PROBLEM_REMOVED`).
- **Data Protection**: Underlying problems table (`problems`) and its associated `test_cases` are completely isolated and untouched by relationship deletion.
- **Frontend**: `AdminContestProblemList.jsx` previously supported listing (7.5.5.2) and adding (7.5.5.3) problems. It lacked the Remove button and confirmation dialog.

## Architecture Reused
- **RBAC & Authorization**: Reused `authenticate` and `authorizeRoles('professor', 'contest_admin', 'super_admin')` middlewares, along with service-layer `canManageResource(req.user, contest)` BOLA checks.
- **Lifecycle Engine**: Reused `getContestRuntimeState(contest)` and `isLifecycleMutationLocked(runtimeState)` from `contestService.js` to enforce mutation locks on `running`, `ended`, and `archived` contests.
- **Atomic Concurrency Control**: Reused PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) in `ContestModel.removeProblemFromContestWithSafety` to prevent race conditions during concurrent removals.
- **Audit Logging**: Reused `AuditLogger.logAction` for `CONTEST_PROBLEM_REMOVED` and `PRIVILEGED_ACTION_DENIED`.
- **Rate Limiting**: Reused `contestActionRateLimiter`.

## Backend Changes
- **`backend/src/controllers/contestController.js`**:
  - Hardened `removeProblemFromContest`:
    - Validates `contestId` and `problemId` as positive integers, returning `400 Bad Request` if invalid.
    - Resolves contest; returns `404 Not Found` if nonexistent.
    - Enforces ownership/RBAC via `canManageResource`; returns `403 Forbidden` and logs `PRIVILEGED_ACTION_DENIED` on unauthorized access.
    - Validates runtime lifecycle state; returns `409 Conflict` if locked.
    - Checks catalog problem existence; returns `404 Not Found` if problem does not exist.
    - Calls `ContestModel.removeProblemFromContestWithSafety`; returns `404 Not Found` if problem is not attached to this contest.
    - Returns structured HTTP `200 OK` `{ status: 'success', message: 'Problem removed from contest successfully', contestId, problemId }`.
- **`backend/src/middleware/contestValidation.js`**:
  - Added and exported `validateRemoveProblemFromContest` middleware validating positive integer parameters.
- **`backend/src/routes/contestRoutes.js`**:
  - Bound `validateRemoveProblemFromContest` to `DELETE /:contestId/problems/:problemId`.

## Frontend Changes
- **`frontend/src/components/admin/AdminContestProblemList.jsx`**:
  - Added `onProblemRemoved` prop callback.
  - Added `Remove` action button on each attached problem row for authorized users (`canManageProblems`).
  - Added lifecycle lock handling: if contest is running/ended/archived, button is disabled with explanatory tooltip.
  - Added accessible confirmation dialog (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="remove-problem-dialog-title"`):
    - Prominently displays: `"Are you sure you want to remove \"{title}\" from this contest?"`
    - Explicit warning callout: `"This removes the problem from this contest. The problem itself will remain available in the problem bank."`
    - Prevents accidental deletion with Cancel and Remove Problem buttons.
    - Double-click and duplicate-submit prevention (`isRemoving` disables buttons and shows spinner).
    - Keyboard accessibility: Escape key closes modal safely when not actively submitting.
    - Handles HTTP 401, 403, 404, 409, 422, 429, 500, and network failures with user feedback.
    - Automatically updates local state, re-fetches problems list, refreshes problem count and total points tally.
  - Strictly excluded any reorder controls or drag-and-drop handles.
- **`frontend/src/components/admin/AdminContestManagement.jsx`**:
  - Wired `onProblemRemoved` to trigger contest re-inspection so parent management views remain synchronized.

## API Changes
- **`DELETE /api/contests/:contestId/problems/:problemId`**:
  - **Auth**: Bearer JWT (`professor`, `contest_admin`, `super_admin`).
  - **Rate Limit**: `contestActionRateLimiter`.
  - **Success Response** (`200 OK`):
    ```json
    {
      "status": "success",
      "message": "Problem removed from contest successfully",
      "contestId": 420,
      "problemId": 1046
    }
    ```
  - **Error Responses**:
    - `400 Bad Request`: Malformed or negative contestId/problemId.
    - `401 Unauthorized`: Missing or invalid JWT.
    - `403 Forbidden`: Professor attempting to remove from another professor's contest or student role.
    - `404 Not Found`: Contest not found, problem not found in catalog, or problem not attached to this contest.
    - `409 Conflict`: Contest runtime state is running, ended, or archived.
    - `429 Too Many Requests`: Rate limit exceeded.

## RBAC
- **Super Admin**: Allowed to remove problems from any contest.
- **Contest Admin**: Allowed to remove problems from any contest.
- **Professor (Owner)**: Allowed to remove problems from contests where `contest.createdBy === user.id`.
- **Professor (Non-Owner)**: Explicitly denied with `403 Forbidden` and audited via `PRIVILEGED_ACTION_DENIED`.
- **Student**: Explicitly denied with `403 Forbidden`.
- **Unauthenticated**: Denied with `401 Unauthorized`.

## Lifecycle Enforcement
- Authoritative runtime lifecycle evaluation:
  - `draft`: Removal allowed.
  - `upcoming`: Removal allowed.
  - `running`: Removal blocked with `409 Conflict` ("Cannot modify contest problems while the contest is running.").
  - `ended`: Removal blocked with `409 Conflict`.
  - `archived`: Removal blocked with `409 Conflict`.

## Validation
- Route parameters `contestId` and `problemId` must parse as positive integers (> 0).
- Handled at middleware level via `validateRemoveProblemFromContest` and reinforced at controller level.
- Non-integer or negative inputs immediately return `400 Bad Request`.

## Relationship Deletion Behavior
- Deletion targets only the `contest_problems` table via:
  ```sql
  DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = $2 RETURNING problem_id;
  ```
- If the problem exists in the catalog but was not attached to the contest, returns `404 Not Found` (`Problem was not found in this contest`).

## Underlying Problem Protection
- Underlying record in `problems` table is **never deleted**. Verified by database queries in tests.
- Problem metadata (`title`, `difficulty`, `coding_mode`, `access_scope`, etc.) remains 100% intact.
- Associated test cases in `test_cases` table remain 100% intact.

## Transaction / Concurrency Safety
- `ContestModel.removeProblemFromContestWithSafety` opens a transaction (`BEGIN`), locks the contest row (`SELECT ... FOR UPDATE`), verifies lifecycle state, executes `DELETE FROM contest_problems`, writes audit log, and commits (`COMMIT`).
- Tested with simultaneous concurrent delete requests: exactly one request succeeds (`200 OK`), and the competing request safely receives `404 Not Found` (`Problem was not found in this contest`). Database state remains consistent.

## Audit Logging
- Successful removals log audit action `CONTEST_PROBLEM_REMOVED` with actor ID, contest resource ID, outcome `success`, and metadata `{ problemId }`.
- Unauthorized removal attempts log audit action `PRIVILEGED_ACTION_DENIED` with actor ID, outcome `denied`, and metadata `{ attemptedAction: 'CONTEST_PROBLEM_REMOVED', problemId }`.
- Denied mutations against locked contests log `PRIVILEGED_ACTION_DENIED` with `operation: 'remove'` and `runtimeState`.
- Zero sensitive data (passwords, tokens, hidden test cases) is logged.

## Data Integrity
- Verified via automated tests:
  - Submissions count in `submissions` remains unchanged.
  - Contest participants in `contest_participants` remain unchanged.
  - Contest configuration (`isRated`, etc.) remains unchanged.
  - Leaderboard rating finalization status remains unchanged.

## Tests Added
1. **`backend/test_admin_phase5_5_4_remove_problem.js`** (31 automated assertions):
   - RBAC (super_admin, contest_admin, owner professor, cross-professor 403, student 403, unauthenticated 401).
   - Parameter validation (invalid contestId 400, invalid problemId 400, negative ID 400).
   - Resource existence (nonexistent contest 404, nonexistent problem 404, unattached problem 404).
   - Contest lifecycle lock (running contest returns 409 Conflict).
   - Successful removal (200 OK, list updated).
   - Underlying problem protection (record in `problems` untouched, metadata unchanged, `test_cases` untouched).
   - Data integrity (submissions, participants, rating, leaderboard untouched).
   - Concurrency safety (simultaneous delete race condition handled cleanly).
   - Audit logging (`CONTEST_PROBLEM_REMOVED` and `PRIVILEGED_ACTION_DENIED`).
   - Security hardening (injected payload ignored, rate limiting headers preserved).
2. **`frontend/test_admin_phase5_5_4_remove_problem_ui.js`** (31 automated assertions):
   - Button visibility & authorization checks.
   - Lifecycle lock state detection.
   - Confirmation dialog opening and clear relationship-only messaging.
   - Cancel action behavior.
   - Successful removal list, problem count, and total points tally refresh.
   - Loading state and duplicate-click prevention.
   - HTTP 401, 403, 404, 409, 422, 429, 500, and network error handling.
   - Dialog accessibility (Escape key, aria-modal, role="dialog").
   - Functional continuity with Add Problem workflow.
   - Strict exclusion of ordering controls.

## Targeted Test Results
- **Backend Targeted Suite** (`test_admin_phase5_5_4_remove_problem.js`): **31 / 31 PASSED (0 failed)**
- **Frontend Targeted Suite** (`test_admin_phase5_5_4_remove_problem_ui.js`): **31 / 31 PASSED (0 failed)**

## Regression Results
- **Phase 7.5.5.2 Contest Problem List**:
  - `backend/test_admin_phase5_5_2_contest_problem_list.js`: **31 / 31 PASSED (0 failed)**
  - `frontend/test_admin_phase5_5_2_contest_problem_list_ui.js`: **20 / 20 PASSED (0 failed)**
- **Phase 7.5.5.3 Add Problem to Contest**:
  - `backend/test_admin_phase5_5_3_add_problem.js`: **42 / 42 PASSED (0 failed)**
  - `frontend/test_admin_phase5_5_3_add_problem_ui.js`: **24 / 24 PASSED (0 failed)**
- **Phase 7.5.3 Create Contest**:
  - `backend/test_admin_phase5_3_create_contest.js`: **66 / 66 PASSED (0 failed)**
  - `frontend/test_admin_phase5_3_create_contest_ui.js`: **22 / 22 PASSED (0 failed)**
- **Phase 7.5.4 Edit Contest**:
  - `frontend/test_admin_phase7_5_4_edit_contest_ui.js`: **51 / 51 PASSED (0 failed)**
- **Phase 3 Core Contest & Problem Suite**:
  - `backend/test_phase3.js`: **32 / 32 PASSED (0 failed)**
- **API Security Suite**:
  - `backend/test_phase_api_security.js`: **13 / 13 PASSED (0 failed)**
- **Deletion Safety Suite**:
  - `backend/test_phase5_9_2_2_deletion_safety.js`: **23 / 23 PASSED (0 failed)**
- **Contest Lifecycle Locks Suite**:
  - `backend/test_phase5_9_2_4_contest_lifecycle_locks.js`: **26 / 26 PASSED (0 failed)**
- **Contest Problem Locks Suite**:
  - `backend/test_phase5_9_2_5_contest_problem_locks.js`: **31 / 31 PASSED (0 failed)**

## Security Testing
- **BOLA Protection**: Verified that Professor B attempting to delete a problem attached to Professor A's contest is denied with `403 Forbidden` and audited.
- **Student Privilege Escalation**: Verified that student role cannot call delete endpoint (`403 Forbidden`).
- **Unauthenticated Access**: Verified that unauthenticated requests receive `401 Unauthorized`.
- **Underlying Problem Protection**: Verified that deleting a contest-problem relationship leaves the `problems` record and `test_cases` untouched.
- **Lifecycle Bypass Defense**: Verified that malicious requests targeting running contests return `409 Conflict`.
- **Protected Field Injection Defense**: Verified that injecting contest fields (`status`, `isRated`, `createdBy`) into DELETE request body is ignored and cannot corrupt the contest.
- **Race Condition Safety**: Verified that concurrent deletion requests do not cause double deletes or database anomalies.

## Build Verification
- Command: `npm run build` in `frontend/`
- Output: Vite production build succeeded with **0 errors**.

## Startup / Health Verification
- Endpoint: `GET /api/health`
- HTTP Status: `200 OK`
- Response Payload:
  ```json
  {
    "server": "OK",
    "database": "OK"
  }
  ```

## Known Issues
None. All targeted and regression tests passed cleanly.

## Performance Notes
- Database deletion is indexed on `(contest_id, problem_id)` primary key in `contest_problems`.
- Single row deletion executes within < 5ms under transaction row lock.
- Frontend utilizes debounced search and memoized handlers to maintain UI responsiveness.

## Final Status
**COMPLETE** — All requirements for Phase 7.5.5.4 (Remove Problem from Contest) have been implemented, tested, and verified.

## Git Checkpoint
- Commit Message: `Phase 7.5.5.4: Remove Problem from Contest`
- Tag: `phase-7.5.5.4-remove-problem-complete`
