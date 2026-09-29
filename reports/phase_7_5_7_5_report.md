# Phase 7.5.7.5 — Bulk Participant Operations

## 1. Goal

The objective of Phase 7.5.7.5 is to add secure, transaction-safe bulk participant management on top of the individual participant management functionality established in Phase 7.5.7.4. Authorized contest managers (Super Admins, Contest Admins, and owning Professors) must be able to batch-enroll and batch-remove contest participants with atomic transactional safety, database row-level locking, server-side duplicate deduplication, submission history dependency protection, strict rate limiting, audit logging, and informative per-item operation summaries.

---

## 2. Initial Architecture Audit

Before implementation, an in-depth architecture audit was conducted across the backend, frontend, database, and test suites:

- **Existing Bulk-Related Functionality**:
  - `ContestModel.bulkAddProblemsWithSafety` and `ContestModel.bulkRemoveProblemsWithSafety` in Phase 7.5.5 established conventions for transaction-safe batch operations with `SELECT ... FOR UPDATE` locking and batch limit caps (100 items).
  - No bulk endpoints existed for participant enrollment or removal prior to this phase.
- **Existing Individual Participant Functionality**:
  - `POST /api/contests/:id/participants` (manual single add, Phase 7.5.7.4).
  - `DELETE /api/contests/:id/participants/:userId` (manual single remove, Phase 7.5.7.4).
  - `POST /api/contests/:id/join` (student self-enrollment, Phase 7.5.7.3).
  - `GET /api/contests/:id/search-students` (candidate student discovery, Phase 7.5.7.4).
- **Existing Reusable APIs / Services**:
  - `canManageResource(req.user, contest)` in `authMiddleware.js`.
  - `AuditLogger.logAction` in `AuditLogger.js` for persistent security logging.
  - `contestActionRateLimiter` in `rateLimitMiddleware.js` for mutation throttling.
  - `getContestRuntimeState(contest)` for deterministic lifecycle evaluation.
- **Existing Database Constraints**:
  - `contest_participants` table: Composite primary key `(contest_id, user_id)`.
  - Foreign key constraints: `contest_id REFERENCES contests(id) ON DELETE CASCADE`, `user_id REFERENCES users(id) ON DELETE CASCADE`.
  - B-tree indexes: `idx_contest_participants_contest` on `(contest_id)` and `idx_contest_participants_user` on `(user_id)`.
  - `submissions` table: `contest_id REFERENCES contests(id) ON DELETE RESTRICT`, `user_id REFERENCES users(id)`.
- **Existing Authorization Rules**:
  - Super Admin & Contest Admin have global contest management privileges.
  - Professors are strictly restricted to contests they created (`createdBy === currentUser.id`). Accessing other contests triggers an immediate 403 Forbidden with BOLA audit logging.
  - Students have zero administrative management rights (403 Forbidden).
- **Existing Lifecycle Rules**:
  - Participant modifications are permitted during `draft` and `running` states.
  - Modifications are strictly locked once the contest is `ended` or `archived` (409 Conflict).
- **Existing UI Components**:
  - `AdminContestParticipantList.jsx` provides search, sort, pagination, and detail inspection modals.
- **Identified Risks**:
  - Route order conflict in Express: `/:id/participants/:userId` could capture `/:id/participants/bulk` if registered first. Resolved by defining bulk routes ahead of parameterized routes.
  - Submission integrity risk: Deleting participants with contest submissions would corrupt historical competition data. Resolved with batch check `SELECT DISTINCT user_id FROM submissions WHERE contest_id = $1 AND user_id = ANY($2::int[])`.

---

## 3. Existing Functionality Reused

- **RBAC & Authorization**: Reused `canManageResource` and `authorizeRoles('professor', 'contest_admin', 'super_admin')`.
- **Lifecycle Engine**: Reused `getContestRuntimeState` and contest status locking logic.
- **Database Schema**: Reused composite primary key `(contest_id, user_id)` and existing foreign keys without altering tables.
- **Audit System**: Reused `AuditLogger.logAction` using project standard events `BULK_PARTICIPANTS_ADDED`, `BULK_PARTICIPANTS_REMOVED`, and `PRIVILEGED_ACTION_DENIED`.
- **Rate Limiting**: Reused `contestActionRateLimiter` on all bulk mutation endpoints.
- **Frontend UI**: Extended `AdminContestParticipantList.jsx` to preserve all existing Phase 7.5.7.2 and 7.5.7.4 features while seamlessly adding multi-select checkboxes, bulk actions bar, and batch confirmation modals.

---

## 4. Implemented Features

1. **Authoritative Bulk Add Endpoint (`POST /api/contests/:id/participants/bulk`)**:
   - Accepts array of student IDs (`{ userIds: [...] }`).
   - Deduplicates IDs in the request payload.
   - Batch queries user records and existing contest participants.
   - Enforces student role (`role === 'student'`) and active account status (`is_active = true`).
   - Inserts eligible students via `ON CONFLICT (contest_id, user_id) DO NOTHING`.
   - Returns structured per-item breakdown (`summary`, `added`, `alreadyEnrolled`, `invalid`).
2. **Authoritative Bulk Remove Endpoints (`DELETE /api/contests/:id/participants/bulk`, `DELETE /api/contests/:id/participants`, `POST /api/contests/:id/participants/bulk-remove`)**:
   - Accepts array of participant user IDs.
   - Batch checks existing enrollment.
   - Authoritatively queries submissions in the contest to preserve competition history and foreign key dependencies.
   - Atomically removes submission-free participants.
   - Returns structured per-item breakdown (`summary`, `removed`, `blockedWithSubmissions`, `notEnrolled`).
3. **Transaction Safety & Atomicity**:
   - Both operations execute inside PostgreSQL database transactions (`BEGIN ... COMMIT / ROLLBACK`).
   - Row-level lock (`SELECT ... FOR UPDATE`) on the target contest row ensures synchronization across concurrent administrative requests.
4. **Batch Size Protection**:
   - Enforces a maximum batch size limit of 100 items per request server-side via `validateBulkAddParticipants` and `validateBulkRemoveParticipants`.
5. **Multi-Select Roster UI**:
   - Checkbox column in participant table.
   - Master checkbox in `<thead>` for "Select All Visible" on current page.
   - Multi-select action toolbar showing selected count, "Clear Selection", and "Remove Selected (N)".
   - Bulk removal confirmation modal displaying selected participant count and submission integrity safeguards.
6. **Multi-Select Candidate Student Add Modal**:
   - Checkboxes for selecting multiple candidate students simultaneously.
   - "Select All Visible" / "Deselect All" button and selected counter.
   - Dynamic action button: "Add N Students to Contest".
   - Structured result notification banner reporting additions, duplicates, and invalid entries.

---

## 5. Backend Changes

1. **`backend/src/middleware/contestValidation.js`**:
   - Added `validateBulkAddParticipants`: Validates positive integer contest ID, non-empty array of user IDs/participant objects, maximum limit of 100 items, and positive integer IDs.
   - Added `validateBulkRemoveParticipants`: Validates contest ID, non-empty array of participant IDs, maximum limit of 100 items, and positive integer IDs.
   - Exported both validation middleware functions.
2. **`backend/src/models/contestModel.js`**:
   - Added `ContestModel.bulkAddParticipantsWithSafety(contestId, userIds, actor, req)`:
     - Transactional with `SELECT ... FOR UPDATE` locking on the contest row.
     - Lifecycle enforcement (`ended` and `archived` contests return `{ locked: true }`).
     - Payload deduplication via `Set`.
     - Batch query for user accounts and existing enrollments.
     - Role and active status validation.
     - Safe insertion using `ON CONFLICT (contest_id, user_id) DO NOTHING`.
     - Per-item categorization: `added`, `alreadyEnrolled`, `invalid`.
     - Persistent audit logging via `BULK_PARTICIPANTS_ADDED`.
   - Added `ContestModel.bulkRemoveParticipantsWithSafety(contestId, userIds, actor, req)`:
     - Transactional with `SELECT ... FOR UPDATE` locking on the contest row.
     - Lifecycle enforcement (`ended` and `archived` contests return `{ locked: true }`).
     - Batch queries existing enrollment and historical contest submissions.
     - Submission dependency preservation: blocks deletion of users with recorded submissions (`blockedWithSubmissions`).
     - Atomic deletion of eligible participants: `DELETE FROM contest_participants WHERE contest_id = $1 AND user_id = ANY($2::int[])`.
     - Per-item categorization: `removed`, `blockedWithSubmissions`, `notEnrolled`.
     - Persistent audit logging via `BULK_PARTICIPANTS_REMOVED`.
3. **`backend/src/controllers/contestController.js`**:
   - Added `bulkAddContestParticipants`: Validates contest existence, RBAC ownership (`canManageResource`), runtime lifecycle state, payload boundaries, executes model method, and returns HTTP 201 (or 200 for idempotent re-runs) with structured breakdown.
   - Added `bulkRemoveContestParticipants`: Validates contest existence, RBAC ownership, runtime lifecycle state, payload boundaries, executes model method, and returns HTTP 200 with structured breakdown.
   - Exported `bulkAddContestParticipants` and `bulkRemoveContestParticipants`.
4. **`backend/src/routes/contestRoutes.js`**:
   - Registered `POST /:id/participants/bulk` with `authorizeRoles`, `contestActionRateLimiter`, and `validateBulkAddParticipants`.
   - Registered `DELETE /:id/participants/bulk`, `DELETE /:id/participants`, and `POST /:id/participants/bulk-remove` with `validateBulkRemoveParticipants`.
   - Ensured bulk routes are declared BEFORE parameterized route `DELETE /:id/participants/:userId` to prevent Express routing collisions.

---

## 6. Frontend Changes

1. **`frontend/src/components/admin/AdminContestParticipantList.jsx`**:
   - **State**: Added `selectedParticipantIds`, `isBulkRemoveModalOpen`, `isBulkRemoving`, `bulkRemoveModalError`, and `selectedCandidateIds`.
   - **Multi-select Table Controls**:
     - Checkbox column in table header for "Select All Visible" with indeterminate/checked synchronization.
     - Checkbox in each table row for individual participant selection with row highlight background.
   - **Bulk Action Toolbar**:
     - Appears when `selectedParticipantIds.length > 0`.
     - Displays selected count indicator, "Clear selection" button, and "Remove Selected (N)" button.
   - **Bulk Remove Confirmation Modal**:
     - Displays contest ID and exact count of selected participants.
     - Clear submission integrity warning explaining that students with contest submissions will not be removed.
     - Action buttons with loading spinners and error handling.
   - **Candidate Student Multi-Select in Add Modal**:
     - Upgraded candidate cards from radio buttons to checkboxes.
     - "Select All Visible" / "Deselect All" button in candidate list header.
     - Real-time counter of selected candidate students.
     - Dynamic button label ("Add N Students to Contest").
     - Calls authoritative bulk add endpoint and surfaces structured result notifications.

---

## 7. Database Changes

- **Schema Changes Required**: **NONE**.
- **Schema Integrity Verified**:
  - `contest_participants` table already possesses primary key `(contest_id, user_id)` and foreign keys to `contests(id)` and `users(id)` with `CASCADE`.
  - `submissions` table foreign key `contest_id REFERENCES contests(id) ON DELETE RESTRICT` protects contest references.
  - Existing indexes `idx_contest_participants_contest` and `idx_contest_participants_user` provide O(log N) lookup and batch operation performance.
  - No migrations were needed, preserving zero downtime and full backward compatibility.

---

## 8. API Changes

| Method | Endpoint | Access / Roles | Description |
|---|---|---|---|
| `POST` | `/api/contests/:id/participants/bulk` | Professor (owner), Contest Admin, Super Admin | Bulk enrolls an array of students into the contest. Handles deduplication and per-item status. Returns HTTP 201/200. |
| `DELETE` | `/api/contests/:id/participants/bulk` | Professor (owner), Contest Admin, Super Admin | Bulk removes an array of participants from the contest with submission history protection. Returns HTTP 200. |
| `DELETE` | `/api/contests/:id/participants` | Professor (owner), Contest Admin, Super Admin | Standard REST alias for bulk removal. Accepts `{ userIds: [...] }`. |
| `POST` | `/api/contests/:id/participants/bulk-remove` | Professor (owner), Contest Admin, Super Admin | Client-friendly POST alias for bulk removal in firewall/proxy environments. |

---

## 9. RBAC & Authorization

- **Super Admin (`super_admin`)**: Full bulk add and bulk remove access across all contests.
- **Contest Admin (`contest_admin`)**: Full bulk add and bulk remove access across all contests.
- **Professor (`professor`)**:
  - Authorized only for contests they created (`createdBy === currentUser.id`).
  - Access to other professors' contests is rejected with HTTP 403 Forbidden and logged as `PRIVILEGED_ACTION_DENIED` (Broken Object Level Authorization / BOLA defense).
- **Student (`student`)**:
  - Strictly blocked from all bulk participant management endpoints with HTTP 403 Forbidden.
- **Unauthenticated**:
  - Strictly blocked with HTTP 401 Unauthorized.

---

## 10. Lifecycle Enforcement

- **`draft` & `running` Contests**:
  - Bulk add is permitted.
  - Bulk remove is permitted (subject to submission integrity checks).
- **`ended` Contests**:
  - Bulk add is rejected with HTTP 409 Conflict (`Cannot add participants: Contest has already ended`).
  - Bulk remove is rejected with HTTP 409 Conflict (`Cannot remove participants: Contest has already ended`).
- **`archived` Contests**:
  - Bulk add is rejected with HTTP 409 Conflict (`Cannot add participants: Contest is archived`).
  - Bulk remove is rejected with HTTP 409 Conflict (`Cannot remove participants: Contest is archived`).

---

## 11. Transaction & Concurrency Safety

- **Atomic Transactions**:
  - All bulk mutations execute within PostgreSQL transactions (`BEGIN ... COMMIT / ROLLBACK`).
- **Row-Level Locking**:
  - The contest row is acquired via `SELECT ... FROM contests WHERE id = $1 FOR UPDATE`. This ensures concurrent bulk operations on the same contest queue up deterministically without data corruption or deadlocks.
- **Deduplication Inside Requests**:
  - Request user IDs are sanitized via `Set` deduplication. E.g., `[3279, 3279, 3279]` results in exactly 1 addition.
- **Database Conflict Handling**:
  - Bulk insertion uses `ON CONFLICT (contest_id, user_id) DO NOTHING` to guarantee that concurrent overlapping batches never violate uniqueness or fail with unhandled 500 errors.
- **Historical Data & Academic Integrity**:
  - Before participant rows are deleted, `SELECT DISTINCT user_id FROM submissions WHERE contest_id = $1 AND user_id = ANY($2::int[])` checks whether participants have submitted code. Participants with submissions are protected from deletion (`blockedCount`), safeguarding leaderboard and audit history.

---

## 12. Rate Limiting & Batch Limits

- **Rate Limiting**:
  - Enforced via `contestActionRateLimiter` on all bulk routes (60 mutations per 15-minute window per IP/user).
- **Batch Size Limit**:
  - Minimum: 1 participant ID (empty array rejected with HTTP 400 Bad Request).
  - Maximum: 100 participants per request (batches > 100 rejected with HTTP 400 Bad Request: `Participants array exceeds maximum allowed limit of 100 items`).
  - Rationale: 100 items keeps single transaction execution duration well under 50ms, avoiding prolonged row lock contention while easily accommodating classroom batches.

---

## 13. Audit Logging

Every bulk participant operation generates persistent structured audit records in the PostgreSQL `audit_logs` table via `AuditLogger.logAction`:
- **`BULK_PARTICIPANTS_ADDED`**: Recorded on successful bulk enrollment.
  - Metadata: `contestId`, `totalRequested`, `addedCount`, `alreadyEnrolledCount`, `invalidCount`, `addedStudentIds`, `runtimeState`.
- **`BULK_PARTICIPANTS_REMOVED`**: Recorded on successful bulk removal.
  - Metadata: `contestId`, `totalRequested`, `removedCount`, `blockedCount`, `notEnrolledCount`, `removedUserIds`, `runtimeState`.
- **`PRIVILEGED_ACTION_DENIED`**: Recorded on unauthorized attempts by non-owning professors or students.
- **Security Sanitization**: Audit logs strictly exclude password hashes, JWT secrets, and sensitive tokens.

---

## 14. Security Testing

Security checks verified through automated tests:
1. Unauthenticated bulk add rejected (HTTP 401).
2. Unauthenticated bulk remove rejected (HTTP 401).
3. Student role attempting bulk add rejected (HTTP 403).
4. Student role attempting bulk remove rejected (HTTP 403).
5. Non-owning professor bulk add rejected with BOLA audit log (HTTP 403).
6. Non-owning professor bulk remove rejected with BOLA audit log (HTTP 403).
7. Contest Admin access authorized (HTTP 201/200).
8. Super Admin access authorized (HTTP 201/200).
9. Nonexistent contest returns HTTP 404.
10. Malformed contest ID returns HTTP 400.
11. Empty userIds array returns HTTP 400.
12. Non-array userIds returns HTTP 400.
13. Negative and non-integer IDs return HTTP 400.
14. Oversized batches (>100 items) rejected with HTTP 400.
15. Inactive students and non-student roles categorized as invalid.
16. Duplicate IDs inside the same request deduplicated safely.
17. Already-enrolled students categorized without aborting remaining valid additions.
18. Participants with contest submissions blocked from deletion.
19. SQL injection in contest ID safely handled without SQL syntax leaks.
20. Sensitive fields (`password_hash`, tokens) strictly absent from API responses.
21. Concurrent overlapping bulk adds complete with zero duplicate rows and zero 500 errors.
22. Repeated identical bulk requests are idempotent and report already-enrolled students.

---

## 15. Tests Added

1. **`backend/test_admin_phase5_7_5_bulk_participants.js`**:
   - 45 automated integration tests verifying authentication, RBAC, input validation, batch boundaries, bulk additions, deduplication, mixed batches, submission protection, lifecycle locks, concurrency, audit logging, and SQL injection shielding.
2. **`frontend/test_admin_phase5_7_5_bulk_participants_ui.js`**:
   - 27 automated unit tests verifying participant multi-selection, candidate multi-selection, select all visible, deselect all, result summary formatting, submission protection notifications, RBAC, lifecycle rules, and batch limits.

---

## 16. Test Results

### Phase 7.5.7.5 Backend Integration Suite
- **Passed**: 45
- **Failed**: 0
- **Skipped**: 0

### Phase 7.5.7.5 Frontend UI Suite
- **Passed**: 27
- **Failed**: 0
- **Skipped**: 0

---

## 17. Regression Results

All relevant previous phases and test suites were executed to verify zero regression:

| Test Suite | Focus Area | Result |
|---|---|---|
| `backend/test_admin_phase5_7_5_bulk_participants.js` | Phase 7.5.7.5 Bulk Operations Backend | **45 Passed, 0 Failed** |
| `frontend/test_admin_phase5_7_5_bulk_participants_ui.js` | Phase 7.5.7.5 Bulk Operations UI | **27 Passed, 0 Failed** |
| `backend/test_admin_phase5_7_4_manual_participant_mgmt.js` | Phase 7.5.7.4 Manual Participant Backend | **41 Passed, 0 Failed** |
| `frontend/test_admin_phase5_7_4_manual_participant_mgmt_ui.js` | Phase 7.5.7.4 Manual Participant UI | **26 Passed, 0 Failed** |
| `backend/test_admin_phase5_7_3_enrollment.js` | Phase 7.5.7.3 Student Enrollment Backend | **25 Passed, 0 Failed** |
| `frontend/test_admin_phase5_7_3_enrollment_ui.js` | Phase 7.5.7.3 Student Enrollment UI | **14 Passed, 0 Failed** |
| `backend/test_admin_phase5_7_2_participant_list.js` | Phase 7.5.7.2 Participant List Backend | **35 Passed, 0 Failed** |
| `frontend/test_admin_phase5_7_2_participant_list_ui.js` | Phase 7.5.7.2 Participant List UI | **22 Passed, 0 Failed** |
| `backend/test_admin_phase5_6_contest_lifecycle.js` | Contest Lifecycle Engine | **75 Passed, 0 Failed** |
| `backend/test_admin_phase5_5_10_security_hardening.js` | Contest API Security Hardening | **67 Passed, 0 Failed** |

**Total Regression Tests Passed**: **377 Passed, 0 Failed**.

---

## 18. Build Verification

- **Command**: `npm run build` in `frontend/`
- **Output**:
  ```
  vite v8.2.1 building client environment for production...
  transforming...✓ 1880 modules transformed.
  rendering chunks...
  computing gzip size...
  dist/index.html                   1.12 kB │ gzip:   0.61 kB
  dist/assets/index-C0EVv8yi.css  236.96 kB │ gzip:  35.84 kB
  dist/assets/index-B_FfGFX7.js   976.18 kB │ gzip: 219.34 kB
  ✓ built in 655ms
  ```
- **Result**: Production build succeeded with zero syntax, JSX, or bundling errors.

---

## 19. Startup / Health Verification

- **Command**: `node scratch/test_health.js`
- **Output**:
  ```
  Server started on port: 63669
  HEALTH CHECK STATUS: 200
  HEALTH CHECK BODY: {"server":"OK","database":"OK"}
  [DATABASE] PostgreSQL pool has been closed gracefully.
  ```
- **Result**: Backend server starts cleanly, PostgreSQL connection pool initializes properly, and `/api/health` returns status 200 OK.

---

## 20. Performance Notes

- Batch queries (`WHERE id = ANY($1::int[])`) replace N+1 queries for both student profile checks and submission verification.
- Database index on `(contest_id, user_id)` ensures index seeks rather than sequential scans.
- In-memory set lookups (`Set.has()`) inside transactions maintain low latency (sub-50ms for maximum batch size of 100 items).
- Row-level lock (`FOR UPDATE`) on the contest prevents transaction serialization anomalies without blocking unrelated contests.

---

## 21. Known Issues

- None. All requirements, security constraints, and tests pass with zero regressions.

---

## 22. Final Status

**COMPLETE**. All requirements of Phase 7.5.7.5 — Bulk Participant Operations have been designed, audited, implemented, and verified across backend, frontend, database, and comprehensive regression test suites.
