# Phase 7.5.5.5 — Problem Ordering

## Phase
Phase 7.5.5.5 — Problem Ordering (Sub-phase of Phase 7.5.5: Contest Problems / Ordering)

## Goal
Allow authorized contest managers (`super_admin`, `contest_admin`, and owner `professor`) to sequentially reorder problems already attached to a contest. The new order is persisted server-side in the existing `contest_problems.problem_order` column, producing deterministic, contiguous 1-indexed positions ($1$ to $N$) with zero duplicates, gaps, negative positions, or foreign problem IDs.

## Audit Findings
- **Database Schema**: The join table `contest_problems` already contains `problem_order INTEGER NOT NULL DEFAULT 1` alongside primary key `(contest_id, problem_id)`.
- **Query Patterns**: Existing queries in `contestModel.js` and `standingsService.js` order problems deterministically using `cp.problem_order ASC, p.id ASC`.
- **Route & Controller**:
  - Reordering routes `PUT /api/contests/:contestId/problems/order`, `PUT /api/contests/:id/problems/order`, `PATCH /api/contests/:contestId/problems/order`, and `PATCH /api/contests/:id/problems/order` were wired to `contestController.reorderContestProblems`.
  - Delegation was also connected in `bulkAddProblemsToContest` so that calling `PUT /api/contests/:id/problems` with `{ problemIds }` delegates cleanly.
- **Frontend**: `AdminContestProblemList.jsx` previously had list view, add problem modal, and remove problem dialog. It needed Reorder mode toggle, Move Up / Move Down buttons, boundary constraints, and save/cancel workflows.

## Existing Ordering Mechanism
- **Authoritative Field**: `contest_problems.problem_order` (`INTEGER NOT NULL DEFAULT 1`).
- **Positions**: For $N$ attached problems, positions are normalized to contiguous 1-indexed integers from $1$ to $N$.
- **Determinism**: Queries uniformly sort by `cp.problem_order ASC, p.id ASC`.

## Backend Changes
- **`backend/src/models/contestModel.js`**:
  - Added `reorderContestProblemsWithSafety(contestId, orderedProblemIds, actor, req)`:
    - Initiates a database transaction with a row-level lock on the contest (`SELECT id, created_by, status, start_time, end_time FROM contests WHERE id = $1 FOR UPDATE`).
    - Verifies contest existence (`404 Not Found`).
    - Evaluates authoritative contest runtime state via `getContestRuntimeState`; rejects mutations with `409 Conflict` if locked (`running`, `ended`, `archived`).
    - Retrieves currently attached problem IDs and validates that:
      - Count of provided problem IDs matches attached problems count exactly.
      - Every problem ID is a valid positive integer.
      - Problem IDs are strictly unique (no duplicates).
      - Every problem ID belongs to the contest (rejects foreign problem IDs).
    - Iterates through the sanitized array and updates `problem_order = index + 1` for each problem.
    - Transactionally logs audit event `CONTEST_PROBLEMS_REORDERED` with metadata containing `problemCount` and `orderedProblemIds`.
    - Returns updated problem list ordered by `problemOrder ASC`.
- **`backend/src/controllers/contestController.js`**:
  - Implemented `reorderContestProblems`:
    - Validates positive integer contest ID parameter (`400 Bad Request`).
    - Extracts candidate problem IDs supporting formats `{ problemIds: [...] }`, `{ orderedProblemIds: [...] }`, `{ problems: [...] }`, `{ order: [...] }`, or direct array.
    - Enforces ownership/RBAC via `canManageResource`; rejects unauthorized professors with `403 Forbidden` and audits `PRIVILEGED_ACTION_DENIED`. Rejects students with `403 Forbidden`.
    - Enforces lifecycle locks (`409 Conflict`).
    - Invokes `ContestModel.reorderContestProblemsWithSafety`.
    - Returns structured HTTP `200 OK` `{ status: 'success', message: 'Problem order updated successfully', contestId, problems }`.
- **`backend/src/middleware/contestValidation.js`**:
  - Added and exported `validateReorderContestProblems`:
    - Validates contest ID parameter is a positive integer.
    - Validates request body contains non-empty candidate list.
    - Validates all problem IDs are positive integers and unique.
- **`backend/src/routes/contestRoutes.js`**:
  - Registered `PUT /:contestId/problems/order`, `PUT /:id/problems/order`, `PATCH /:contestId/problems/order`, and `PATCH /:id/problems/order` with `authenticate`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, `contestActionRateLimiter`, and `validateReorderContestProblems`.

## Frontend Changes
- **`frontend/src/components/admin/AdminContestProblemList.jsx`**:
  - Accepted `onProblemReordered` prop callback.
  - Added state management: `isReorderMode`, `reorderProblems`, `isSavingOrder`, and `reorderError`.
  - Added action buttons in header:
    - `[Reorder]` button (`data-testid="toggle-reorder-button"`) visible to authorized managers when attached problems > 1.
    - `[Cancel]` button (`data-testid="cancel-reorder-button"`) discarding changes and restoring original order.
    - `[Save Order]` button (`data-testid="save-order-button"`) with loading spinner and duplicate-click prevention.
  - Added `reorder-mode-banner` (`data-testid="reorder-mode-banner"`) and `reorder-error` banner (`data-testid="reorder-error"`).
  - Integrated accessible Move Up (`data-testid="move-up-problem-${probId}"`) and Move Down (`data-testid="move-down-problem-${probId}"`) controls per problem row during reorder mode:
    - Disabled Move Up on boundary index 0.
    - Disabled Move Down on boundary index $N - 1$.
    - Dynamic position badge (`data-testid="problem-order-badge-${probId}"`) rendering updated sequence `#{idx + 1}` in real time.
  - Full keyboard accessibility and error handling for HTTP 400, 401, 403, 404, 409, 422, 429, 500, and network failures.
- **`frontend/src/components/admin/AdminContestManagement.jsx`**:
  - Connected `onProblemReordered={() => onInspectContest && onInspectContest(inspectedContest.id)}` to keep parent contest view synchronized.

## API Changes
- **`PUT /api/contests/:contestId/problems/order`** (and `PATCH`):
  - **Auth**: Bearer JWT (`professor`, `contest_admin`, `super_admin`).
  - **Rate Limit**: `contestActionRateLimiter`.
  - **Request Body**:
    ```json
    {
      "problemIds": [102, 101, 103]
    }
    ```
  - **Success Response** (`200 OK`):
    ```json
    {
      "status": "success",
      "message": "Problem order updated successfully",
      "contestId": 451,
      "problems": [
        {
          "problemId": 102,
          "title": "Reverse Linked List",
          "difficulty": "medium",
          "codingMode": "full_program",
          "problemOrder": 1,
          "points": 200
        },
        {
          "problemId": 101,
          "title": "Two Sum",
          "difficulty": "easy",
          "codingMode": "function",
          "problemOrder": 2,
          "points": 100
        },
        {
          "problemId": 103,
          "title": "Median of Two Sorted Arrays",
          "difficulty": "hard",
          "codingMode": "function",
          "problemOrder": 3,
          "points": 300
        }
      ]
    }
    ```
  - **Error Responses**:
    - `400 Bad Request`: Malformed payload, duplicate problem IDs, foreign problem IDs, missing problem IDs, or non-numeric IDs.
    - `401 Unauthorized`: Unauthenticated.
    - `403 Forbidden`: Student role or professor attempting to reorder another professor's contest.
    - `404 Not Found`: Contest not found.
    - `409 Conflict`: Contest runtime state is running, ended, or archived.
    - `429 Too Many Requests`: Rate limit exceeded.

## RBAC
- **Super Admin**: Allowed to reorder problems in any contest.
- **Contest Admin**: Allowed to reorder problems in any contest.
- **Professor (Owner)**: Allowed to reorder problems in own contests (`contest.createdBy === user.id`).
- **Professor (Non-Owner)**: Explicitly denied with `403 Forbidden` and audited via `PRIVILEGED_ACTION_DENIED`.
- **Student**: Explicitly denied with `403 Forbidden`.
- **Unauthenticated**: Denied with `401 Unauthorized`.

## Lifecycle Enforcement
- Evaluates runtime state via `getContestRuntimeState(contest)`:
  - `draft`: Reordering permitted.
  - `upcoming`: Reordering permitted.
  - `running`: Reordering strictly blocked with `409 Conflict` ("Cannot modify contest problems while contest is running").
  - `ended`: Reordering strictly blocked with `409 Conflict`.
  - `archived`: Reordering strictly blocked with `409 Conflict`.

## Validation
- Rejects empty arrays (`400 Bad Request`).
- Rejects duplicate problem IDs (`400 Bad Request`).
- Rejects foreign problem IDs not attached to this contest (`400 Bad Request`).
- Rejects partial arrays omitting attached problems (`400 Bad Request`).
- Rejects non-numeric, negative, or zero problem IDs (`400 Bad Request`).
- Rejects malformed JSON bodies (`400 Bad Request`).

## Concurrency Safety
- Row-level lock `SELECT ... FROM contests WHERE id = $1 FOR UPDATE` acquired inside an explicit database transaction.
- Concurrent reorder requests are serialized; second transaction waits for lock release, re-evaluates state, and updates positions without deadlocks or position collisions.
- Contiguous 1-indexed order $1$ to $N$ is guaranteed invariant.

## Data Integrity
- Reordering modifies **only** the `contest_problems.problem_order` column.
- Under tests:
  - Problem definitions (`problems` table: title, description, difficulty, codingMode) remained byte-for-byte identical.
  - Test cases (`test_cases` table) remained completely intact.
  - Submissions (`submissions` table) remained unchanged.
  - Contest participants (`contest_participants` table) remained unchanged.
  - Contest rating configurations (`is_rated`) remained unchanged.
  - Leaderboard standings computation functioned seamlessly after reordering.

## Audit Logging
- Successful reorders record an audit event via `AuditLogger.logAction`:
  - `action`: `CONTEST_PROBLEMS_REORDERED`
  - `resourceType`: `contest`
  - `resourceId`: `contestId`
  - `outcome`: `SUCCESS`
  - `metadata`: `{ problemCount, orderedProblemIds }`
- Unauthorized attempts record `PRIVILEGED_ACTION_DENIED` with actor and target contest.

## Tests Added
- **`backend/test_admin_phase5_5_5_problem_ordering.js`** (34 assertions covering all 25 backend requirements):
  1. authorized contest_admin reorder (200 OK)
  2. authorized super_admin reorder (200 OK)
  3. professor own-contest reorder (200 OK)
  4. professor cross-contest rejection (403 Forbidden)
  5. student rejection (403 Forbidden)
  6. unauthenticated rejection (401 Unauthorized)
  7. valid reorder (200 OK)
  8. two-problem reorder
  9. multi-problem reorder
  10. duplicate problem IDs rejected (400 Bad Request)
  11. foreign problem ID rejected (400 Bad Request)
  12. invalid problem ID rejected (400 Bad Request)
  13. malformed payload rejected (400 Bad Request)
  14. lifecycle lock enforced (409 Conflict on running contest)
  15. deterministic final ordering
  16. duplicate positions prevented
  17. missing positions prevented
  18. concurrent reorder safety
  19. audit event verification
  20. rate limiting headers
  21. underlying problem data unchanged
  22. submissions unchanged
  23. participants unchanged
  24. ratings configuration unchanged
  25. leaderboard standings computation intact
- **`frontend/test_admin_phase5_5_5_problem_ordering_ui.js`** (25 assertions covering all 20 frontend requirements):
  1. authorized reorder UI visibility
  2. unauthorized UI hidden/disabled
  3. current order rendering
  4. move up
  5. move down
  6. boundary behavior (top/bottom)
  7. save button workflow
  8. loading state
  9. duplicate-submit prevention
  10. success refresh
  11. validation error banner
  12. HTTP 403 handling
  13. HTTP 409 handling
  14. HTTP 422 handling
  15. HTTP 500 handling
  16. network failure handling
  17. keyboard accessibility
  18. Add Problem continuity
  19. Remove Problem continuity
  20. scope boundary enforcement (no later-phase bulk transfer or examination features)

## Targeted Results
- `node backend/test_admin_phase5_5_5_problem_ordering.js`: **34/34 Passed, 0 Failed** (Exit Code 0).
- `node frontend/test_admin_phase5_5_5_problem_ordering_ui.js`: **25/25 Passed, 0 Failed** (Exit Code 0).

## Regression Results
- `node backend/test_admin_phase5_5_2_contest_problem_list.js`: **31/31 Passed, 0 Failed**
- `node frontend/test_admin_phase5_5_2_contest_problem_list_ui.js`: **20/20 Passed, 0 Failed**
- `node backend/test_admin_phase5_3_create_contest.js`: **66/66 Passed, 0 Failed**
- `node frontend/test_admin_phase5_3_create_contest_ui.js`: **22/22 Passed, 0 Failed**
- `node frontend/test_admin_phase7_5_4_edit_contest_ui.js`: **51/51 Passed, 0 Failed**
- `node backend/test_admin_phase5_5_3_add_problem.js`: **42/42 Passed, 0 Failed**
- `node frontend/test_admin_phase5_5_3_add_problem_ui.js`: **24/24 Passed, 0 Failed**
- `node backend/test_admin_phase5_5_4_remove_problem.js`: **31/31 Passed, 0 Failed**
- `node frontend/test_admin_phase5_5_4_remove_problem_ui.js`: **31/31 Passed, 0 Failed**
- `node backend/test_phase3.js`: **32/32 Passed, 0 Failed**
- `node backend/test_phase_api_security.js`: **13/13 Passed, 0 Failed**
- `node backend/test_phase5_9_2_2_deletion_safety.js`: **23/23 Passed, 0 Failed**
- `node backend/test_phase5_9_2_4_contest_lifecycle_locks.js`: **26/26 Passed, 0 Failed**
- `node backend/test_phase5_9_2_5_contest_problem_locks.js`: **31/31 Passed, 0 Failed**

## Security Testing
- **BOLA / Ownership Isolation**: Non-owner professor cannot reorder another professor's contest (returns 403 Forbidden; audited with `PRIVILEGED_ACTION_DENIED`).
- **RBAC**: Students receive 403 Forbidden; unauthenticated requests receive 401 Unauthorized.
- **Lifecycle Bypass Protection**: Running contests reject reorder requests with 409 Conflict.
- **Foreign Problem Injection**: Problems not belonging to the contest are rejected with 400 Bad Request.
- **Duplicate Position Prevention**: Duplicate problem IDs in payload are rejected with 400 Bad Request.
- **Rate Limiting**: Enforced via `contestActionRateLimiter`.
- **Audit Logging**: Recorded in `audit_logs` without leaking sensitive secrets.

## Build Verification
- `npm run build` in `frontend/`:
  - Output: `dist/index.html` (1.12 kB), `dist/assets/index-CZH9Z1f5.css` (236.75 kB), `dist/assets/index-CPPaDtbC.js` (921.69 kB).
  - Status: Built successfully in 3.04s with zero compilation errors.

## Startup / Health
- Endpoint: `GET /api/health`
- Response: `HTTP 200 OK`
- Body: `{"server":"OK","database":"OK"}`

## Known Issues
- None. All functional, concurrency, security, and integrity requirements pass.

## Performance Notes
- Reorder operations are executed within a single transaction using `SELECT FOR UPDATE` and indexed updates on `(contest_id, problem_id)`.
- Client-side Move Up / Move Down operations are performed in memory; single atomic PUT request is dispatched upon clicking Save Order.

## Final Status
- **Phase 7.5.5.5 — Problem Ordering**: **COMPLETE** ✅
- All 25 backend invariants and 20 frontend invariants verified.
- Production build clean.
- System health verified.

## Git Checkpoint
- Commit: `Phase 7.5.5.5: Problem Ordering`
- Tag: `phase-7.5.5.5-problem-ordering-complete`
