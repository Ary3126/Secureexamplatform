# Phase 7.5.5.6 — Bulk / Atomic Problem Ordering

## Phase
Phase 7.5.5.6 — Bulk / Atomic Problem Ordering (Sub-phase of Phase 7.5.5: Contest Problems / Ordering)

## Goal
Harden the contest problem ordering mechanism into a strictly atomic, collision-proof database operation. When an authorized contest manager updates the sequence of attached problems, the entire set of affected rows in `contest_problems` must transition atomically from the previous sequence to the new sequence within an explicit database transaction. If any error, constraint violation, or unexpected exception occurs during execution, the transaction rolls back cleanly, leaving the previous valid ordering 100% intact.

## Audit Findings
- **Database Schema**: The join table `contest_problems` stores `(contest_id, problem_id)` as its primary key, with `problem_order INTEGER NOT NULL DEFAULT 1`.
- **Row-by-Row vs. Statement-Level Update**:
  - The initial implementation in Phase 7.5.5.5 executed individual row-by-row `UPDATE contest_problems SET problem_order = $1 WHERE contest_id = $2 AND problem_id = $3` statements inside a transaction loop.
  - If a unique constraint or statement trigger exists or is added on `(contest_id, problem_order)`, sequential row-by-row updates could trigger intermediate unique constraint collisions when swapping positions (e.g. updating problem A to position 2 when problem B already occupies position 2).
- **Atomicity Opportunity**:
  - By replacing the multi-statement loop with a single parameterized `UPDATE contest_problems SET problem_order = (CASE ... END)::int WHERE contest_id = $1 AND problem_id = ANY($2::int[])` statement, all problem positions are updated simultaneously within a single SQL statement execution.
  - In PostgreSQL, statement-level unique constraints are evaluated at statement completion, eliminating transient position collisions.
- **Verification Invariant**:
  - An explicit post-update verification step before `COMMIT` guarantees that the resulting order strictly matches the requested permutation and contiguous $1$ to $N$ indexing.

## Existing Ordering Implementation
- Reused the existing `contest_problems.problem_order` column.
- Query patterns uniformly order by `cp.problem_order ASC, p.id ASC`.
- Frontend already provides accessible Move Up / Move Down controls and dispatches the full ordered problem array payload `{ problemIds: [...] }`.

## Atomic Transaction Design
The complete bulk reorder follows a rigorous 8-step lifecycle within an isolated database transaction:
1. `BEGIN`: Starts transaction with a dedicated database client.
2. **Contest Verification & Lock**: Executes `SELECT id, start_time, end_time, status FROM contests WHERE id = $1 FOR UPDATE`. Rejects nonexistent contests with `404 Not Found`.
3. **Lifecycle Check**: Evaluates authoritative runtime state via `getContestRuntimeState`. If `running`, `ended`, or `archived`, executes `ROLLBACK` and returns `409 Conflict`.
4. **Row Lock on Joined Records**: Executes `SELECT problem_id FROM contest_problems WHERE contest_id = $1 FOR UPDATE` to lock all relation records and prevent concurrent additions or removals.
5. **Complete Set Validation**: Authoritatively compares the candidate list against attached problems:
   - Validates problem count matches attached count exactly.
   - Validates all problem IDs are positive integers and unique.
   - Validates every candidate problem ID is currently attached to the contest (rejects foreign and nonexistent problem IDs).
6. **Collision-Safe Single-Statement Update**:
   ```sql
   UPDATE contest_problems
   SET problem_order = (CASE
     WHEN problem_id = $2::int THEN $3::int
     WHEN problem_id = $4::int THEN $5::int
     ...
   END)::int
   WHERE contest_id = $1 AND problem_id = ANY($N::int[]);
   ```
7. **Verification & Audit**:
   - Queries updated problems: `SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC, problem_id ASC`.
   - Explicitly verifies that row count matches and each `problem_order` equals its expected 1-indexed position.
   - Transactionally logs audit event `CONTEST_PROBLEMS_REORDERED` with problem count and ordered ID metadata.
8. `COMMIT`: Commits all changes atomically. If any error is thrown at any step, `ROLLBACK` is executed and the client connection is released.

## Complete Set Validation
The server strictly enforces complete set integrity against the authoritative database state:
- **Count Matching**: Rejects payloads containing fewer or more problem IDs than currently attached (`400 Bad Request`).
- **Duplicate Prevention**: Rejects payloads containing duplicate IDs (`400 Bad Request`).
- **Foreign Problem Rejection**: Rejects problem IDs that exist in the platform catalog but are not attached to this contest (`400 Bad Request`).
- **Nonexistent Problem Rejection**: Rejects nonexistent IDs (`400 Bad Request`).
- **Malformed Payloads**: Rejects empty arrays, non-numeric values, negative numbers, or invalid JSON structures (`400 Bad Request`).

## Constraint Collision Handling
- In Phase 7.5.5.6, sequential `UPDATE` queries were replaced with a single parameterized `CASE` update statement.
- Because PostgreSQL evaluates unique constraints at the end of statement execution, temporary collisions during swaps (e.g. swapping position 1 and position 2) do not fail, ensuring smooth, collision-free updates without altering or dropping database constraints.

## Concurrency Protection
- Dual row-level locks are acquired:
  1. `SELECT ... FROM contests WHERE id = $1 FOR UPDATE`
  2. `SELECT ... FROM contest_problems WHERE contest_id = $1 FOR UPDATE`
- Simultaneous reorder requests for the same contest serialize cleanly: the second transaction waits for the lock, re-reads the committed state, and completes safely without deadlocks or position collisions.

## RBAC
- **Super Admin**: Allowed to reorder problems in any contest.
- **Contest Admin**: Allowed to reorder problems in any contest.
- **Professor (Owner)**: Allowed to reorder problems in own contests (`contest.createdBy === user.id`).
- **Professor (Non-Owner)**: Denied with `403 Forbidden` and audited via `PRIVILEGED_ACTION_DENIED`.
- **Student**: Denied with `403 Forbidden`.
- **Unauthenticated**: Denied with `401 Unauthorized`.

## Lifecycle Enforcement
- Enforced at both controller and transactional model levels.
- Reordering is permitted only when contest runtime state is `draft` or `upcoming`.
- Reordering is strictly blocked with `409 Conflict` if the contest has transitioned to `running`, `ended`, or `archived`.

## Backend Changes
- **`backend/src/models/contestModel.js`**:
  - Upgraded `reorderContestProblemsWithSafety`:
    - Added `FOR UPDATE` lock to `contest_problems` query.
    - Replaced sequential row-by-row update loop with single-statement parameterized `CASE ... END` query with explicit `::int` casts.
    - Added pre-commit verification checking that every row in the database precisely matches the requested sequence and contiguous $1$ to $N$ positions.
    - Maintained transactional rollback and error propagation.

## Frontend Changes
- **`frontend/src/components/admin/AdminContestProblemList.jsx`**:
  - Reused the complete ordering UX from Phase 7.5.5.5.
  - Generates complete authoritative payload `{ problemIds: [...] }`.
  - Enforces duplicate submit prevention and displays loading state during save.
  - Notifies parent via `onProblemReordered` upon successful atomic commit.
  - Shows clear error alerts and preserves user context if the server returns an error.

## API Changes
- **`PUT /api/contests/:contestId/problems/order`** (and `PATCH`):
  - **Payload**: `{ "problemIds": [id1, id2, id3, ...] }`
  - **Success Response** (`200 OK`):
    ```json
    {
      "status": "success",
      "message": "Contest problems reordered successfully",
      "contestId": 488,
      "problems": [
        {
          "problemId": 1116,
          "problemOrder": 1,
          "points": 300
        },
        ...
      ]
    }
    ```
  - **Error Responses**:
    - `400 Bad Request`: Incomplete problem set, duplicate problem ID, foreign problem ID, invalid ID format.
    - `401 Unauthorized`: Unauthenticated.
    - `403 Forbidden`: Student role or non-owner professor.
    - `404 Not Found`: Contest not found.
    - `409 Conflict`: Contest runtime state is running, ended, or archived.
    - `500 Internal Server Error`: Transaction rolled back upon unexpected failure.

## Audit Logging
- Successful bulk reorders log a `CONTEST_PROBLEMS_REORDERED` audit event containing:
  - `action`: `CONTEST_PROBLEMS_REORDERED`
  - `actor`: Authenticated user context
  - `resourceType`: `contest`
  - `resourceId`: `contestId`
  - `outcome`: `SUCCESS`
  - `metadata`: `{ problemCount, orderedProblemIds }`
- Unauthorized attempts log `PRIVILEGED_ACTION_DENIED`.

## Data Integrity
- Bulk reordering strictly mutates only `contest_problems.problem_order`.
- Verified in tests:
  - Problem definitions (`problems` table: title, description, difficulty, codingMode) remained untouched.
  - Test cases (`test_cases` table) remained untouched.
  - Submissions (`submissions` table) remained untouched.
  - Contest participants (`contest_participants` table) remained untouched.
  - Contest rating configurations (`is_rated`) remained untouched.
  - Standings and leaderboard computation functioned seamlessly after reordering.

## Tests Added
- **`backend/test_admin_phase5_5_6_bulk_ordering.js`** (36 assertions covering all 28 requirements):
  1. complete reorder succeeds (200 OK)
  2. two-problem swap (200 OK, DB verified)
  3. multi-problem reorder (200 OK, DB verified)
  4. exact complete problem set accepted
  5. missing problem rejected (400 Bad Request, DB order preserved)
  6. duplicate problem rejected (400 Bad Request)
  7. foreign problem rejected (400 Bad Request)
  8. nonexistent problem rejected (400 Bad Request)
  9. invalid payload rejected (400 Bad Request)
  10. student rejected (403 Forbidden)
  11. professor ownership enforced (403 Forbidden on other's contest, 200 on own)
  12. contest_admin allowed (200 OK)
  13. super_admin allowed (200 OK)
  14. lifecycle lock enforced (409 Conflict on running contest)
  15. transaction commits all updates atomically
  16. transaction rollback on failure (CRITICAL TRANSACTION TEST)
  17. no duplicate positions (all positions distinct)
  18. no missing positions (contiguous 1 to N)
  19. concurrency protection (parallel reorders serialize without corruption or deadlocks)
  20. repeated identical ordering is safe (idempotency)
  21. audit log generated (CONTEST_PROBLEMS_REORDERED with actor, target, metadata)
  22. rate limiting preserved
  23. underlying problem unchanged
  24. submissions unchanged
  25. participants unchanged
  26. ratings unchanged
  27. leaderboard unchanged
  28. final database order matches request
- **`frontend/test_admin_phase5_5_6_bulk_ordering_ui.js`** (17 assertions covering all 16 requirements):
  1. complete ordering payload generated
  2. Save Order state
  3. loading state
  4. duplicate submit prevention
  5. success refresh
  6. server ordering displayed
  7. incomplete-order error
  8. HTTP 403 handling
  9. HTTP 409 handling
  10. HTTP 422 handling
  11. HTTP 500 handling
  12. network failure handling
  13. existing Add Problem remains functional
  14. existing Remove Problem remains functional
  15. keyboard & accessibility behavior
  16. scope boundary enforcement (no later-phase UI)

## Transaction Rollback Testing
- Verified using an active database trigger that raises a runtime exception during the update statement (`trg_test_order_abort_trigger`).
- Result:
  - The API call immediately failed with HTTP 500 (`Simulated database failure during reorder`).
  - Database verification confirmed that the previous ordering remained **100% intact**: zero rows were partially updated or corrupted.
  - After removing the temporary trigger, reordering completed normally and committed cleanly.

## Targeted Test Results
- `node backend/test_admin_phase5_5_6_bulk_ordering.js`: **36/36 Passed, 0 Failed** (Exit Code 0).
- `node frontend/test_admin_phase5_5_6_bulk_ordering_ui.js`: **17/17 Passed, 0 Failed** (Exit Code 0).

## Regression Results
- `node backend/test_admin_phase5_5_5_problem_ordering.js`: **34/34 Passed, 0 Failed**
- `node frontend/test_admin_phase5_5_5_problem_ordering_ui.js`: **25/25 Passed, 0 Failed**
- `node backend/test_admin_phase5_5_2_contest_problem_list.js`: **31/31 Passed, 0 Failed**
- `node frontend/test_admin_phase5_5_2_contest_problem_list_ui.js`: **20/20 Passed, 0 Failed**
- `node backend/test_admin_phase5_5_3_add_problem.js`: **42/42 Passed, 0 Failed**
- `node frontend/test_admin_phase5_5_3_add_problem_ui.js`: **24/24 Passed, 0 Failed**
- `node backend/test_admin_phase5_5_4_remove_problem.js`: **31/31 Passed, 0 Failed**
- `node frontend/test_admin_phase5_5_4_remove_problem_ui.js`: **31/31 Passed, 0 Failed**
- `node backend/test_admin_phase5_3_create_contest.js`: **66/66 Passed, 0 Failed**
- `node frontend/test_admin_phase5_3_create_contest_ui.js`: **22/22 Passed, 0 Failed**
- `node frontend/test_admin_phase7_5_4_edit_contest_ui.js`: **51/51 Passed, 0 Failed**
- `node backend/test_phase3.js`: **32/32 Passed, 0 Failed**
- `node backend/test_phase_api_security.js`: **13/13 Passed, 0 Failed**
- `node backend/test_phase5_9_2_2_deletion_safety.js`: **23/23 Passed, 0 Failed**
- `node backend/test_phase5_9_2_4_contest_lifecycle_locks.js`: **26/26 Passed, 0 Failed**
- `node backend/test_phase5_9_2_5_contest_problem_locks.js`: **31/31 Passed, 0 Failed**

## Security Testing
- **BOLA / Ownership Isolation**: Non-owner professor rejected with `403 Forbidden` and audited via `PRIVILEGED_ACTION_DENIED`.
- **RBAC**: Students rejected with `403 Forbidden`. Unauthenticated requests rejected with `401 Unauthorized`.
- **Lifecycle Bypass Protection**: Running contests reject reorder requests with `409 Conflict`.
- **Foreign Problem Injection**: Problems not belonging to the contest are rejected with `400 Bad Request`.
- **Duplicate Problem IDs**: Payloads with duplicate problem IDs are rejected with `400 Bad Request`.
- **Rate Limiting**: Enforced via `contestActionRateLimiter`.
- **Audit Logging**: Recorded in `audit_logs` without leaking sensitive secrets.

## Build Verification
- Command: `npm run build` in `frontend/`
- Output: `dist/index.html` (1.12 kB), `dist/assets/index-CZH9Z1f5.css` (236.75 kB), `dist/assets/index-CPPaDtbC.js` (921.69 kB).
- Status: Built in 1.55s with zero compilation errors.

## Startup / Health Verification
- Endpoint: `GET /api/health`
- Status: `HTTP 200 OK`
- Body: `{"server":"OK","database":"OK"}`

## Known Issues
- None. All functional, concurrency, security, atomicity, and integrity requirements pass.

## Performance Notes
- The single-statement parameterized `CASE ... END` update reduces database round-trips from $N$ to $1$, significantly improving execution performance for contests with large problem sets.
- Contiguous 1-indexed order $1$ to $N$ is maintained in $O(N)$ time.

## Final Status
- **Phase 7.5.5.6 — Bulk / Atomic Problem Ordering**: **COMPLETE** ✅
- All 28 backend invariants and 16 frontend invariants verified.
- Production build clean.
- System health verified.

## Git Checkpoint
- Commit: `Phase 7.5.5.6: Bulk Atomic Problem Ordering`
- Tag: `phase-7.5.5.6-bulk-atomic-ordering-complete`
