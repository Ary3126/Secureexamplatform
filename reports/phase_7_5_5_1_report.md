# Phase 7.5.5.1 — Contest Problems / Ordering Architecture & Audit

## Phase
- **Project**: ExamForge — Coding Practice, Competitive Programming & Secure Examination Platform
- **Phase**: Phase 7 — Admin Panel V1 Re-development
- **Sub-Phase**: Phase 7.5.5.1 — Contest Problems / Ordering Architecture & Audit
- **Status**: Complete

---

## Goal
Conduct a thorough, evidence-based architectural audit of the existing contest-problem relationship subsystem across backend routes, controllers, services, database schema, foreign keys, indexes, ordering semantics, concurrency controls, lifecycle locks, RBAC policies, and frontend components before writing implementation code. Establish an authoritative implementation plan for Phase 7.5.5 (Contest Problems / Ordering) ensuring 100% reuse of the existing production-proven backend infrastructure.

---

## Existing Architecture
The contest problem management architecture is built on a normalized relational model established in Phase 3 and hardened in Phase 5.9.2:
- **Separation of Concerns**: Problems exist independently in the problem catalog (`problems` table). Contests exist independently in the contest registry (`contests` table). The association between them is managed through a dedicated relational join table (`contest_problems`).
- **Atomic Mutation Boundaries**: Every problem addition, removal, and bulk reordering operation is executed within an isolated PostgreSQL transaction utilizing row-level locks (`SELECT ... FOR UPDATE`) on the contest record.
- **Server-Authoritative Lifecycle Derivation**: Runtime contest state (`draft`, `upcoming`, `running`, `ended`, `archived`) is computed on the server based on immutable system timestamps and the contest status.
- **Audit Logging**: Every successful and rejected privileged action emits structured, sanitized records to `audit_logs` (`CONTEST_PROBLEM_ADDED`, `CONTEST_PROBLEM_REMOVED`, `PRIVILEGED_ACTION_DENIED`).

---

## Existing APIs
The backend already exposes a comprehensive, RESTful set of endpoints for contest problem operations:

| HTTP Method | Route | Controller Method | Validation / Middleware | Description |
|---|---|---|---|---|
| `GET` | `/api/contests/:id` | `contestController.getContestById` | `optionalAuthenticate`, `mediumProtectionRateLimiter` | Retrieves contest details along with attached problems array ordered by `problemOrder ASC` |
| `POST` | `/api/contests/:id/problems` | `contestController.addProblemToContest` | `authenticate`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, `contestActionRateLimiter`, `validateAddProblemToContest` | Attaches a single problem to a contest with custom `points` and `problemOrder` |
| `DELETE` | `/api/contests/:contestId/problems/:problemId` | `contestController.removeProblemFromContest` | `authenticate`, `authorizeRoles(...)`, `contestActionRateLimiter` | Detaches a single problem from a contest |
| `POST` / `PUT` | `/api/contests/:id/problems/bulk`<br>`/api/contests/:id/problems` | `contestController.bulkAddProblemsToContest` | `authenticate`, `authorizeRoles(...)`, `contestActionRateLimiter` | Atomically adds multiple problems or updates points and `problemOrder` via `ON CONFLICT DO UPDATE` |
| `DELETE` | `/api/contests/:id/problems` | `contestController.bulkRemoveProblemsFromContest` | `authenticate`, `authorizeRoles(...)`, `contestActionRateLimiter` | Bulk removes specific problems or clears all problems from a contest |
| `GET` | `/api/problems` | `problemController.getAllProblems` | `optionalAuthenticate`, `mediumProtectionRateLimiter` | Browses the problem catalog with search, difficulty, codingMode, and pagination filters |

**Zero new backend APIs are required.** The existing API surface supports all functional, ordering, and security requirements.

---

## Existing Database Schema
Direct inspection of the PostgreSQL database confirms the following schema:

### 1. `contest_problems` Table
```sql
CREATE TABLE contest_problems (
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    problem_order INTEGER NOT NULL DEFAULT 1,
    points INTEGER NOT NULL DEFAULT 100 CHECK (points > 0),
    PRIMARY KEY (contest_id, problem_id)
);
```

### 2. Constraints & Integrity
- **Primary Key**: `contest_problems_pkey` on `(contest_id, problem_id)`. Guarantees duplicate problem attachments are impossible at the database level.
- **Foreign Keys**:
  - `contest_problems_contest_id_fkey`: `FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE`
  - `contest_problems_problem_id_fkey`: `FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE`
- **Check Constraint**: `contest_problems_points_check`: `CHECK (points > 0)` ensuring points are strictly positive integers.

### 3. Indexes
- `contest_problems_pkey`: Unique B-tree index on `(contest_id, problem_id)`
- `idx_contest_problems_contest`: B-tree index on `(contest_id)`
- `idx_contest_problems_problem`: B-tree index on `(problem_id)`

---

## Existing Ordering Mechanism
- **Column**: `problem_order INTEGER NOT NULL DEFAULT 1` in `contest_problems`.
- **Query Retrieval**: [contestModel.js](file:///d:/Secureexamplatform/backend/src/models/contestModel.js) line 974 retrieves attached problems using:
  ```sql
  SELECT 
    p.id AS "problemId",
    p.title,
    p.description,
    p.difficulty,
    p.coding_mode AS "codingMode",
    p.starter_templates AS "starterTemplates",
    cp.problem_order AS "problemOrder",
    cp.points
  FROM contest_problems cp
  JOIN problems p ON cp.problem_id = p.id
  WHERE cp.contest_id = $1
  ORDER BY cp.problem_order ASC, p.id ASC;
  ```
  The secondary sort on `p.id ASC` ensures deterministic ordering even if two problems share an order index.
- **Reordering Execution**: `PUT /api/contests/:id/problems` executes:
  ```sql
  INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (contest_id, problem_id) 
  DO UPDATE SET points = EXCLUDED.points, problem_order = EXCLUDED.problem_order
  RETURNING contest_id AS "contestId", problem_id AS "problemId", points, problem_order AS "problemOrder";
  ```
  This performs atomic updates of `problem_order` and `points` across all attached problems in a single database round-trip without dropping or recreating relationship rows.

---

## Existing Lifecycle Locks
The platform enforces strict server-authoritative lifecycle mutation locks via `contestService.js` and `contestModel.js`:
- **State Evaluation**: Computed dynamically under row lock:
  - `draft`: Problem mutation fully allowed.
  - `upcoming`: Problem mutation allowed prior to start time.
  - `running`: **STRICTLY LOCKED**. Returns `HTTP 409 Conflict` (`"Cannot mutate problems while contest is running"`).
  - `ended`: **STRICTLY LOCKED**. Returns `HTTP 409 Conflict` (`"Cannot mutate problems for concluded contest"`).
  - `archived`: **STRICTLY LOCKED**. Returns `HTTP 409 Conflict` (`"Cannot mutate problems for archived contest"`).
- **Integrity Justification**: Altering problems, points, or problem ordering during or after a contest corrupts participant submissions, invalidates live scoring, breaks leaderboard freeze snapshots, and corrupts historical Elo ratings.
- **Audit Logging**: Any blocked lifecycle mutation generates a `PRIVILEGED_ACTION_DENIED` audit log.

---

## Existing RBAC
Role-Based Access Control is enforced at both route middleware and controller resource levels:
- **`student`**: Route middleware `authorizeRoles('professor', 'contest_admin', 'super_admin')` returns `HTTP 403 Forbidden`.
- **`professor`**: Permitted to manage problems **only** for contests where `contest.createdBy === req.user.id`. Modifying another professor's contest returns `HTTP 403 Forbidden` (`canManageResource` BOLA/IDOR protection).
- **State Leakage Prevention**: Ownership checks occur **before** lifecycle lock checks. An unauthorized professor attempting to mutate a running contest receives `403 Forbidden`, not `409 Conflict`, preventing leakage of private contest runtime states.
- **`contest_admin` & `super_admin`**: Permitted platform-wide authority to manage problems on any contest.

---

## Existing Problem Access Rules
- Problems are sourced from the central `problems` bank (`GET /api/problems`).
- Problems may be in `public`, `contest_private`, `class`, or `institution` scope.
- Attaching a problem to a contest binds the problem's content and test cases to the contest session.
- Once a contest is published and running, participating students view problem statements and starter templates via the contest execution runner.
- Deletion cascade safety: A problem cannot be deleted from the platform if student submissions exist (`deleteProblemWithSafety` checks `submissions` table).

---

## Existing Transactions / Row Locks
All mutation methods in `contestModel.js` enforce strict transactional consistency:
1. `client = await db.getClient()`
2. `await client.query('BEGIN')`
3. Exclusive row lock on contest:
   ```sql
   SELECT id, start_time, end_time, status FROM contests WHERE id = $1 FOR UPDATE;
   ```
4. Verifies runtime state under lock. If locked, issues `ROLLBACK` and returns `{ locked: true }`.
5. Executes problem operation (`INSERT`, `UPDATE`, or `DELETE`).
6. Logs action in `audit_logs` using the transaction client.
7. `await client.query('COMMIT')`
8. `client.release()` in `finally` block.

This guarantees zero race conditions between concurrent administrative requests and prevents contests from transitioning into active status while problem lists are being modified.

---

## Existing Frontend
At the completion of Phase 7.5.4, the frontend contest administration consists of:
- [AdminContestManagement.jsx](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx):
  - Displays contests table with title, dates, runtime badge, status filter, and pagination.
  - Inspection Drawer (`inspectedContest`) displays read-only attached problems list with order, difficulty, and points.
  - Table row actions provide **Edit** (Phase 7.5.4) and **Leaderboard**, but no dedicated Problems management action.
- [AdminPanel.jsx](file:///d:/Secureexamplatform/frontend/src/components/AdminPanel.jsx):
  - Implements `handleCreateContest` and `handleUpdateContest`.
  - Does not yet implement problem mutation handlers (`onAddProblem`, `onRemoveProblem`, `onBulkAddProblems`, `onUpdateProblems`).
- **Missing UI Component**: A dedicated, accessible modal for managing contest problems (`AdminContestProblemModal.jsx`).

---

## Existing Tests
The platform maintains comprehensive backend test suites covering all problem mutation and locking rules:
- `backend/test_phase3.js`: Phase 3 baseline contest and problem bank suite (32/32 tests passing).
- `backend/test_phase5_9_2_4_contest_lifecycle_locks.js`: Timing mutation locks (26/26 tests passing).
- `backend/test_phase5_9_2_5_contest_problem_locks.js`: Comprehensive problem mutation locks suite (31/31 tests passing):
  - Draft contest allows adding/removing problems for authorized owners.
  - Running contest strictly blocks adding/removing/bulk mutating problems with 409 Conflict.
  - Historical / Ended contest strictly blocks problem mutations with 409 Conflict.
  - Archived contest strictly blocks problem mutations with 409 Conflict.
  - BOLA / IDOR cross-professor problem mutation blocked with 403 Forbidden.
  - Student mutation blocked with 403 Forbidden.
  - Unauthenticated request blocked with 401 Unauthorized.
  - 10 concurrent requests to mutate running contest all safely serialized and rejected with 409 Conflict.
  - Audit logging verification for allowed and denied operations.
- `backend/test_phase5_9_2_6_transaction_boundaries.js`: Multi-statement transactional rollbacks.

---

## Missing Functionality (To Be Built in Phase 7.5.5)
1. **Frontend Component (`AdminContestProblemModal.jsx`)**:
   - Tab 1: **Attached Problems List**:
     - Visual display of attached problems with badges, points, and ordering.
     - Move Up / Move Down buttons for sequential reordering with boundary guards.
     - Inline points editing with live total points tallying.
     - Detach button with explicit confirmation dialog.
     - "Save Points & Ordering" button that sends atomic updates to `PUT /api/contests/:id/problems`.
   - Tab 2: **Browse Problem Bank**:
     - Search and difficulty filter querying `GET /api/problems`.
     - Catalog cards with difficulty badges, coding mode, and "Already Attached" indicator.
     - Quick individual "+ Add" action with custom points input.
     - Multi-select checkboxes and sticky Bulk Actions bar.
   - **Lifecycle Awareness**: Disables all mutation controls and displays an amber warning banner if the contest is active, ended, or archived.
2. **Management Table Integration (`AdminContestManagement.jsx`)**:
   - Add `problemContest` state tracking the target contest.
   - Add "Problems" (`<Layers size={13} />`) button to table row actions for authorized managers.
   - Add "Manage Problems" button in the inspection drawer header.
   - Mount `AdminContestProblemModal`.
3. **AdminPanel Wiring (`AdminPanel.jsx`)**:
   - Implement `handleAddProblemToContest`, `handleRemoveProblemFromContest`, `handleBulkAddProblemsToContest`, and `handleUpdateContestProblems`.
   - Thread handlers to `AdminContestManagement`.
4. **CSS Styles (`adminContestManagement.css`)**:
   - Add modal styling, custom scrollbars, and spin animations.
5. **Automated Frontend Test Suite (`test_admin_phase7_5_5_contest_problems_ui.js`)**:
   - Tests covering lifecycle lock detection, ordering, points, payloads, detach, deduplication, RBAC, and error parsing.

---

## Implementation Plan (Phases 7.5.5.2 – 7.5.5.10)

```
7.5.5.1 Architecture & Audit (Current — COMPLETE)
   ↓
7.5.5.2 Contest Problem List UI
   • Render attached problems in AdminContestProblemModal
   • Display problemOrder, title, difficulty, codingMode, points
   • Empty state with call-to-action
   ↓
7.5.5.3 Add Problem to Contest
   • Catalog browser with search & difficulty filters querying GET /api/problems
   • Single problem attachment via POST /api/contests/:id/problems
   • Prevent duplicate attachment
   ↓
7.5.5.4 Remove Problem from Contest
   • Detach button with confirmation prompt
   • Calls DELETE /api/contests/:contestId/problems/:problemId
   • Updates local list and recalculates points
   ↓
7.5.5.5 Problem Ordering
   • Sequential Move Up / Move Down controls
   • Boundary guards (cannot move #1 up or last down)
   • Continuous 1-based indexing
   ↓
7.5.5.6 Bulk/Atomic Ordering Updates
   • Save Points & Ordering action calling PUT /api/contests/:id/problems
   • Bulk attach selected problems with uniform points
   • Dirty-state tracking for unsaved changes
   ↓
7.5.5.7 Lifecycle & Lock Enforcement
   • Client-side isContestProblemLocked check
   • Amber warning banner for running/ended/archived contests
   • Complete mutation control disabling when locked
   ↓
7.5.5.8 RBAC & Security Validation
   • Role checking (Super Admin, Contest Admin, owning Professor)
   • Hide/disable action buttons for unauthorized users
   • Server error envelope parsing (409 Conflict, 403 Forbidden)
   ↓
7.5.5.9 Testing & Regression
   • Build frontend test suite: test_admin_phase7_5_5_contest_problems_ui.js
   • Verify 100% pass across Phase 7.5.2, 7.5.3, 7.5.4, and backend problem lock suites
   ↓
7.5.5.10 Integration & Completion
   • Wire AdminPanel, AdminContestManagement, and CSS
   • Production build verification (npm run build)
   • Create reports/phase_7_5_5_report.md and tag phase-7.5.5-contest-problems-complete
```

---

## Security Considerations
1. **Server-Authoritative Enforcement**: Client-side disabled buttons and warnings are strictly UX aids; backend endpoints enforce `authenticate`, `authorizeRoles`, `canManageResource`, and `isLifecycleMutationLocked` on every request.
2. **BOLA / IDOR Protection**: Contest ownership check (`canManageResource`) precedes lifecycle checks, preventing cross-tenant information leakage.
3. **Atomic Concurrency Protection**: Row-level locking (`FOR UPDATE`) prevents race conditions between problem attachments and contest starts.
4. **Input Sanitization**: Points inputs must be sanitized to positive integers (`points > 0`) both on frontend and in `validateAddProblemToContest`.
5. **Deduplication**: Database primary key `(contest_id, problem_id)` and backend checks prevent duplicate problem attachments.

---

## Data Integrity Considerations
- Submissions, participant records, rating history, and leaderboard snapshots must never be altered by contest problem mutations.
- Problem ordering must remain continuous, sequential, and 1-based without gaps or duplicates.
- Reordering operations must utilize `ON CONFLICT DO UPDATE` to ensure foreign key integrity without deleting and reinserting rows.

---

## Performance Considerations
- `contest_problems` has indexed foreign keys on both `contest_id` and `problem_id`, ensuring lookups execute in `< 1ms`.
- `getContestProblems` executes a single indexed join between `contest_problems` and `problems`.
- Problem catalog queries (`GET /api/problems`) utilize server-side pagination with default `limit=20` and max `limit=100`.
- Bulk problem reordering updates execute in a single database transaction rather than N round-trips.

---

## Scope Boundaries

### What Will Be Reused
- All database tables (`contests`, `problems`, `contest_problems`, `audit_logs`).
- All backend routes and controller methods (`POST`, `DELETE`, `PUT /api/contests/:id/problems`).
- All backend validation middleware (`validateAddProblemToContest`).
- All lifecycle locking services (`isLifecycleMutationLocked`, `getProblemMutationLockMessage`).
- All RBAC and ownership logic (`canManageResource`).
- All existing backend test suites (`test_phase5_9_2_5_contest_problem_locks.js`).

### What Must Be Changed
- Create `frontend/src/components/admin/AdminContestProblemModal.jsx`.
- Update `frontend/src/components/admin/AdminContestManagement.jsx` to mount modal and add action buttons.
- Update `frontend/src/components/AdminPanel.jsx` to provide problem mutation API handlers.
- Update `frontend/src/components/admin/adminContestManagement.css` for modal styles.
- Create `frontend/test_admin_phase7_5_5_contest_problems_ui.js`.

### What Must NOT Be Changed
- Zero alterations to database schema, tables, foreign keys, or indexes.
- Zero modifications to backend route definitions or API contracts.
- Zero modifications to `submissions`, `contest_participants`, or `rating_history` tables.
- Zero modifications to Phase 7.5.6 features (Publish verification gates, archiving, safe delete).

---

## Final Status
**SUB-PHASE 7.5.5.1 — CONTEST PROBLEMS / ORDERING ARCHITECTURE & AUDIT IS COMPLETE.**
Per the strict stop rule, Sub-Phase 7.5.5.2 has NOT been started. Awaiting user instruction to proceed.
