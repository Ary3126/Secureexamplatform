# CODEFROG — PHASE 7.5.10.5.1
## CONTEST LIFECYCLE STATE MACHINE AUDIT REPORT

---

### 1. Executive Summary

An exhaustive security, architectural, and lifecycle state machine audit was performed on the CODEFROG platform. The audit analyzed all database constraints, ORM/data access models, backend services, Express route definitions, controller dispatch handlers, authorization/RBAC middlewares, submission ingestion gates, rating finalization pipelines, audit logging mechanisms, and React frontend lifecycle management interfaces.

**Core Architecture:**
CODEFROG does not employ a single authoritative status enum. Instead, it implements a **dual-layer composite state machine**:
1. **Persisted Lifecycle Status (`status`)**: Stored in the PostgreSQL `contests` table and strictly constrained by `contests_status_check` to exactly three values: `'draft'`, `'published'`, and `'archived'`.
2. **Derived Dynamic Runtime State (`runtimeState`)**: Calculated deterministically on-the-fly via `getContestRuntimeState(contest)` using the authoritative server clock (`new Date()`):
   - If `status === 'archived'` $\rightarrow$ `'archived'`
   - If `status === 'draft'` $\rightarrow$ `'draft'`
   - If `status === 'published'`:
     - $now < startTime \rightarrow$ `'upcoming'`
     - $now \ge startTime \land now < endTime \rightarrow$ `'running'`
     - $now \ge endTime \rightarrow$ `'ended'`
3. **Sub-State Dimensions**:
   - **Result Finalization**: Governed by `is_rating_finalized` (boolean) and `final_results_snapshot` (JSONB). When true, official contest results and ratings are sealed and immutable.
   - **Leaderboard Freeze**: Derived dynamically via `getContestFreezeState(contest, serverTime)`. During $[endTime - freezeMinutes, endTime]$, `freezeState` transitions to `'FROZEN'`. When finalized, it transitions to `'FINAL'`.

**Audit Verdict:**
The core transactional mechanics (e.g. `SELECT ... FOR UPDATE` row locks, immutable rating finalization, and strict submission rejection outside of `running`) are robust. However, **multiple security gaps** were identified in the generic update endpoint (`PUT/PATCH /api/contests/:id`), contest deletion lifecycle checks, and single-field time updates that bypass dedicated lifecycle endpoints or trigger unhandled database exceptions.

---

### 2. Scope

The following components and source files were audited:
- **Database Schema & Constraints**: `contests`, `contest_problems`, `contest_participants`, `submissions`, `rating_history`.
- **Contest Model**: [`backend/src/models/contestModel.js`](file:///d:/Secureexamplatform/backend/src/models/contestModel.js)
- **Lifecycle & Access Services**:
  - [`backend/src/services/contestService.js`](file:///d:/Secureexamplatform/backend/src/services/contestService.js)
  - [`backend/src/services/contestAccessService.js`](file:///d:/Secureexamplatform/backend/src/services/contestAccessService.js)
  - [`backend/src/services/ratingService.js`](file:///d:/Secureexamplatform/backend/src/services/ratingService.js)
  - [`backend/src/services/standingsService.js`](file:///d:/Secureexamplatform/backend/src/services/standingsService.js)
  - [`backend/src/services/auditLogger.js`](file:///d:/Secureexamplatform/backend/src/services/auditLogger.js)
- **Controllers**:
  - [`backend/src/controllers/contestController.js`](file:///d:/Secureexamplatform/backend/src/controllers/contestController.js)
  - [`backend/src/controllers/submissionController.js`](file:///d:/Secureexamplatform/backend/src/controllers/submissionController.js)
- **Routes & Middleware**:
  - [`backend/src/routes/contestRoutes.js`](file:///d:/Secureexamplatform/backend/src/routes/contestRoutes.js)
  - [`backend/src/middleware/contestValidation.js`](file:///d:/Secureexamplatform/backend/src/middleware/contestValidation.js)
  - [`backend/src/middleware/authMiddleware.js`](file:///d:/Secureexamplatform/backend/src/middleware/authMiddleware.js)
  - [`backend/src/middleware/roleMiddleware.js`](file:///d:/Secureexamplatform/backend/src/middleware/roleMiddleware.js)
- **Frontend Lifecycle Controls**:
  - [`frontend/src/components/AdminPanel.jsx`](file:///d:/Secureexamplatform/frontend/src/components/AdminPanel.jsx)
  - [`frontend/src/components/admin/AdminContestManagement.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx)
  - [`frontend/src/components/admin/AdminContestEditModal.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestEditModal.jsx)

---

### 3. Actual State Model

CODEFROG's state model is a **hybrid composite state machine**:

$$\text{Effective State} = f(\text{status}, \text{start\_time}, \text{end\_time}, \text{is\_rating\_finalized}, \text{now}())$$

1. **Persisted Root State (`status`)**:
   - `'draft'`
   - `'published'`
   - `'archived'`
2. **Computed Temporal Runtime State (`runtimeState`)**:
   - `'draft'`
   - `'upcoming'`
   - `'running'`
   - `'ended'`
   - `'archived'`
3. **Computed Visibility/Display Freeze State (`freezeState`)**:
   - `'NOT_FROZEN'`
   - `'FROZEN'`
   - `'FINAL'`
4. **Finalization State (`is_rating_finalized`)**:
   - `false` (Unfinalized / Mutable standings)
   - `true` (Sealed / Immutable official results snapshot)

---

### 4. State Definitions

| State / Sub-State | Meaning | Stored Where | Who Can Set It | Server Enforced? |
|---|---|---|---|---|
| **DRAFT** | Private contest in authoring mode. Hidden from students; no enrollments or submissions permitted. | `contests.status = 'draft'` | Creator (`professor`), `contest_admin`, `super_admin` | **YES** (`contestAccessService`, `submissionController`) |
| **UPCOMING** | Published contest whose start time is in the future ($now < startTime$). Visible to students; registration open; submissions rejected. | Derived: `status = 'published'` $\land$ $now < startTime$ | Time-derived via server clock | **YES** (`submissionController` rejects with 400) |
| **RUNNING** | Active competition ($startTime \le now < endTime$). Problems accessible to enrolled students; submissions and interactive runs accepted. | Derived: `status = 'published'` $\land$ $startTime \le now < endTime$ | Time-derived via server clock | **YES** (`submissionController` accepts submissions) |
| **ENDED** | Contest elapsed ($now \ge endTime$). Submissions strictly rejected. Standings viewable; pending finalization. | Derived: `status = 'published'` $\land$ $now \ge endTime$ | Time-derived via server clock | **YES** (`submissionController` rejects with 400) |
| **ARCHIVED** | Permanent historical read-only archive. Mutually exclusive with draft/published. Cannot be edited or reopened. | `contests.status = 'archived'` | Contest owner (`professor`), `contest_admin`, `super_admin` | **YES** (`isLifecycleMutationLocked` blocks all updates) |
| **FROZEN** (Sub-state) | Public standings frozen during final minutes before contest close ($endTime - freezeMinutes \le now \le endTime$). | Derived via `getContestFreezeState` | Time-derived from contest settings | **YES** (`standingsService` conceals post-freeze solves) |
| **FINALIZED** (Sub-state) | Final rankings calculated; rating adjustments applied; snapshot sealed. | `contests.is_rating_finalized = true` | Contest owner (`professor`), `contest_admin`, `super_admin` | **YES** (`ratingService`, `ContestModel.updateContestWithSafety`) |

---

### 5. Valid Transition Matrix

| From State | Trigger Action | To State | Authorized Roles | Preconditions | Enforcement Mechanism | Audit Event |
|---|---|---|---|---|---|---|
| `DRAFT` | `POST /api/contests/:id/publish` | `UPCOMING` | Owner, `contest_admin`, `super_admin` | At least 1 problem attached; valid start/end times | `ContestModel.publishContestWithSafety` (DB `FOR UPDATE`) | `CONTEST_PUBLISHED` |
| `DRAFT` | `POST /api/contests/:id/archive` | `ARCHIVED` | Owner, `contest_admin`, `super_admin` | Contest exists; not already archived | `ContestModel.archiveContestWithSafety` (DB `FOR UPDATE`) | `CONTEST_ARCHIVED` |
| `UPCOMING` | `POST /api/contests/:id/unpublish` | `DRAFT` | Owner, `contest_admin`, `super_admin` | Status is `'published'`; $now < startTime$; 0 submissions | `ContestModel.unpublishContestWithSafety` (DB `FOR UPDATE`) | `CONTEST_UNPUBLISHED` |
| `UPCOMING` | Server time advances ($now \ge startTime$) | `RUNNING` | System (automatic) | Valid ISO timestamps in DB | Evaluated dynamically by `getContestRuntimeState` | None (derived) |
| `RUNNING` | Server time advances ($now \ge endTime$) | `ENDED` | System (automatic) | Valid ISO timestamps in DB | Evaluated dynamically by `getContestRuntimeState` | None (derived) |
| `ENDED` | `POST /api/contests/:id/archive` | `ARCHIVED` | Owner, `contest_admin`, `super_admin` | Status is `'published'`; $now \ge endTime$ | `ContestModel.archiveContestWithSafety` (DB `FOR UPDATE`) | `CONTEST_ARCHIVED` |
| `ENDED` | `POST /api/contests/:id/finalize-ratings` | `FINALIZED` | Owner, `contest_admin`, `super_admin` | Status is `'published'`; $now \ge endTime$; 0 pending judge jobs | `ratingService.finalizeContestRatings` (DB `FOR UPDATE`) | `RATINGS_FINALIZED` |
| `FINALIZED` | `POST /api/contests/:id/archive` | `ARCHIVED` | Owner, `contest_admin`, `super_admin` | Final results preserved | `ContestModel.archiveContestWithSafety` (DB `FOR UPDATE`) | `CONTEST_ARCHIVED` |

---

### 6. Invalid Transition Matrix

| Invalid Transition | Possible Attack Vector | Current Code Behavior | Enforcement Point | Severity |
|---|---|---|---|---|
| `RUNNING` $\rightarrow$ `DRAFT` | Attacker calls `/unpublish` while contest is running | Returns HTTP 409: `"Cannot unpublish contest while it is 'running'"` | `ContestModel.unpublishContestWithSafety` (`FOR UPDATE`) | **PASS** |
| `RUNNING` $\rightarrow$ `ARCHIVED` | Attacker calls `/archive` while contest is running | Returns HTTP 409: `"Cannot archive an actively running contest"` | `ContestModel.archiveContestWithSafety` (`FOR UPDATE`) | **PASS** |
| `RUNNING` $\rightarrow$ Alter timing | Attacker calls `PUT /api/contests/:id` to extend or truncate time | Returns HTTP 409: `"Cannot modify contest lifecycle while the contest is running"` | `ContestModel.updateContestWithSafety` (`FOR UPDATE`) | **PASS** |
| `RUNNING` $\rightarrow$ Alter problems | Attacker attempts to add/remove/reorder problems | Returns HTTP 409: `"Cannot modify problems while the contest is running"` | `ContestModel` problem methods (`FOR UPDATE`) | **PASS** |
| `ENDED` $\rightarrow$ `DRAFT` | Attacker calls `/unpublish` on an ended contest | Returns HTTP 409: `"Cannot unpublish contest while it is 'ended'"` | `ContestModel.unpublishContestWithSafety` (`FOR UPDATE`) | **PASS** |
| `ENDED` $\rightarrow$ `RUNNING` | Attacker attempts to change `endTime` into future | Returns HTTP 409: `"Cannot modify contest lifecycle after the contest has ended"` | `ContestModel.updateContestWithSafety` (`FOR UPDATE`) | **PASS** |
| `FINALIZED` $\rightarrow$ Alter Elo / Freeze | Attacker calls `PUT /api/contests/:id` with `isRated: false` | Returns HTTP 409: `"Cannot modify result-affecting contest settings after final results have been published"` | `ContestModel.updateContestWithSafety` (`FOR UPDATE`) | **PASS** |
| `ARCHIVED` $\rightarrow$ Any State | Attacker calls update/publish/unpublish | Returns HTTP 409: `"Cannot modify contest lifecycle for an archived contest"` | `isLifecycleMutationLocked('archived')` | **PASS** |
| `DRAFT` $\rightarrow$ Submit Code | Student attempts to submit code to draft contest problem | Returns HTTP 400: `"Submissions are not allowed for draft / unpublished contests"` | `submissionController.submitCode` | **PASS** |
| `UPCOMING` $\rightarrow$ Submit Code | Student attempts to submit code before start time | Returns HTTP 400: `"Submissions rejected: Contest is currently 'upcoming'"` | `submissionController.submitCode` | **PASS** |
| `ENDED` $\rightarrow$ Submit Code | Student attempts to submit code after end time | Returns HTTP 400: `"Submissions rejected: Contest is currently 'ended'"` | `submissionController.submitCode` | **PASS** |
| `DRAFT` $\rightarrow$ `PUBLISHED` without problems | Attacker sends `{"status": "published"}` via generic `PUT/PATCH /api/contests/:id` | **ALLOWED! Bypasses the 1-problem requirement check!** | **GAP** in `validateUpdateContest` & `updateContestWithSafety` | **HIGH** |
| Actively `RUNNING` $\rightarrow$ `DELETED` | Owner deletes running contest before any student submits code | **ALLOWED! Deletes running contest from DB!** | **GAP** in `deleteContestWithSafety` | **MEDIUM** |

---

### 7. Lifecycle Endpoints

| HTTP Method | Endpoint | Controller Handler | Authorized Roles | Mutation Details | Audit Action |
|---|---|---|---|---|---|
| `POST` | `/api/contests` | `contestController.createContest` | `professor`, `contest_admin`, `super_admin` | Creates contest in `'draft'` status | `CONTEST_CREATED` |
| `PUT` / `PATCH` | `/api/contests/:id` | `contestController.updateContest` | Owner, `contest_admin`, `super_admin` | Updates metadata; can mutate `status`, `startTime`, `endTime` | `CONTEST_UPDATED` |
| `DELETE` | `/api/contests/:id` | `contestController.deleteContest` | Owner, `contest_admin`, `super_admin` | Deletes contest row and relational mappings | `CONTEST_DELETED` |
| `POST` | `/api/contests/:id/publish` | `contestController.publishContest` | Owner, `contest_admin`, `super_admin` | Sets `status = 'published'` (requires $\ge 1$ problem) | `CONTEST_PUBLISHED` |
| `POST` | `/api/contests/:id/unpublish` | `contestController.unpublishContest` | Owner, `contest_admin`, `super_admin` | Sets `status = 'draft'` (requires 0 submissions) | `CONTEST_UNPUBLISHED` |
| `POST` | `/api/contests/:id/archive` | `contestController.archiveContest` | Owner, `contest_admin`, `super_admin` | Sets `status = 'archived'` (requires not running) | `CONTEST_ARCHIVED` |
| `POST` | `/api/contests/:id/finalize-ratings` | `contestController.finalizeContestRatings` | Owner, `contest_admin`, `super_admin` | Seals snapshot; updates user ratings | `RATINGS_FINALIZED` |
| `POST` | `/api/contests/:id/problems` | `contestController.addProblemToContest` | Owner, `contest_admin`, `super_admin` | Attaches problem (locked if running/ended/archived) | `CONTEST_PROBLEM_ADDED` |
| `DELETE` | `/api/contests/:id/problems/:problemId` | `contestController.removeProblemFromContest` | Owner, `contest_admin`, `super_admin` | Detaches problem (locked if running/ended/archived) | `CONTEST_PROBLEM_REMOVED` |

---

### 8. Server Enforcement Points

| Transition / Operation | Client Guard | Auth Middleware | RBAC Middleware | Ownership Helper | Request Validation | Service Guard | DB Row Lock | Audit Logging |
|---|---|---|---|---|---|---|---|---|
| **Create Contest** | Form disabled | `authenticate` | `authorizeRoles` | N/A (sets `req.user.id`) | `validateCreateContest` | Controller check | PG Transaction | `CONTEST_CREATED` |
| **Update Contest** | Form lock | `authenticate` | `authorizeRoles` | `canManageResource` | `validateUpdateContest` | `isLifecycleMutationLocked` | `FOR UPDATE` | `CONTEST_UPDATED` |
| **Publish Contest** | Button hide | `authenticate` | `authorizeRoles` | `canManageResource` | Param ID check | Problem count $\ge 1$ | `FOR UPDATE` | `CONTEST_PUBLISHED` |
| **Unpublish Contest** | Button hide | `authenticate` | `authorizeRoles` | `canManageResource` | Param ID check | `runtimeState === 'upcoming'`, 0 subs | `FOR UPDATE` | `CONTEST_UNPUBLISHED` |
| **Archive Contest** | Button hide | `authenticate` | `authorizeRoles` | `canManageResource` | Param ID check | `runtimeState !== 'running'` | `FOR UPDATE` | `CONTEST_ARCHIVED` |
| **Finalize Ratings** | Button hide | `authenticate` | `authorizeRoles` | `canManageResource` | Param ID check | `status === 'published'`, `ended`, 0 pending | `FOR UPDATE` | `RATINGS_FINALIZED` |
| **Code Submission** | Editor block | `authenticate` | Student check | Enrolled participant | Body validation | `status === 'published'` $\land$ `running` | PG Transaction | Submission audit |

---

### 9. Authorization Matrix

| Operation | Unauthenticated | Student | Professor (Non-owner) | Professor (Owner) | Contest Admin | Super Admin |
|---|---|---|---|---|---|---|
| **Create Contest** | DENY (401) | DENY (403) | ALLOW (201) | ALLOW (201) | ALLOW (201) | ALLOW (201) |
| **View Draft Contest** | DENY (401) | DENY (403) | DENY (403) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| **Update Contest** | DENY (401) | DENY (403) | DENY (403) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| **Publish Contest** | DENY (401) | DENY (403) | DENY (403) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| **Unpublish Contest** | DENY (401) | DENY (403) | DENY (403) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| **Archive Contest** | DENY (401) | DENY (403) | DENY (403) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| **Delete Contest** | DENY (401) | DENY (403) | DENY (403) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| **Finalize Ratings** | DENY (401) | DENY (403) | DENY (403) | ALLOW (200) | ALLOW (200) | ALLOW (200) |
| **Submit Code** | DENY (401) | ALLOW (if running/enrolled) | DENY (403 - must be student) | DENY (403) | DENY (403) | DENY (403) |

*Note: All authorization checks are executed BEFORE any mutation occurs.*

---

### 10. Timestamp and Runtime Logic

- **Authoritative Clock**: Evaluated exclusively using the server process clock via `new Date()`. Client-supplied timestamps or header dates are ignored.
- **Timezone Normalization**: All timestamps are parsed via standard JavaScript ISO-8601 parsing and stored as `TIMESTAMP WITH TIME ZONE` in PostgreSQL (normalized to UTC).
- **Time Invariants**:
  - `check_contest_times`: Enforced at DB level via `CHECK (end_time > start_time)`.
  - Duration constraint: Enforced at validation level via `end - start >= 60000` (at least 1 minute).
- **Automatic Transitions**:
  - Contests transition from `upcoming` $\rightarrow$ `running` and `running` $\rightarrow$ `ended` dynamically based on `new Date()`. No cron job or database worker write is required. This completely prevents contests from becoming "stuck" due to worker crashes.

---

### 11. Publish / Unpublish Analysis

- **Publish Requirements**:
  - Contest must be in `status = 'draft'`.
  - Contest must have at least one problem attached (`SELECT COUNT(*) FROM contest_problems`).
  - Sets `status = 'published'`, emits `CONTEST_PUBLISHED`.
- **Unpublish Requirements**:
  - Contest must be in `status = 'published'`.
  - Contest must be in `runtimeState === 'upcoming'` (cannot unpublish running, ended, or archived).
  - Contest must have **zero** submissions (`SELECT EXISTS (SELECT 1 FROM submissions WHERE contest_id = $1)`).
  - Sets `status = 'draft'`, emits `CONTEST_UNPUBLISHED`.
- **Vulnerability Identified**: The generic update endpoint allows directly sending `{ "status": "published" }`, bypassing the problem attachment check (see Section 15).

---

### 12. Running / Ending Analysis

- **Submission Ingestion Gates**:
  [`submissionController.js`](file:///d:/Secureexamplatform/backend/src/controllers/submissionController.js) checks both `submitCode` and `runCode`:
  1. `if (contest.status !== 'published') return 400;`
  2. `if (runtimeState !== 'running') return 400;`
  3. `if (req.user.role === 'student' && !participant) return 403;`
- **Boundary Precision**:
  - Submission at $t = startTime$: Valid ($now \ge startTime$).
  - Submission at $t = endTime$: Rejected ($now \ge endTime \rightarrow 'ended'$).

---

### 13. Freeze State Analysis

- **Freeze Calculation**:
  - Active when `leaderboardFreezeEnabled === true` and $now \in [\max(startTime, endTime - freezeMinutes), endTime]$.
  - Yields `freezeState = 'FROZEN'`.
- **Integrity**:
  - Freeze affects only the **presentation layer** (`standingsService`).
  - Submissions submitted during freeze are fully judged and persisted with true verdicts.
  - Final results calculation uses true submissions, not the frozen presentation state.
  - After finalization, `freezeState` transitions permanently to `'FINAL'`.

---

### 14. Finalization State Analysis

- **Finalization Invariants**:
  - Uses `SELECT ... FOR UPDATE` row locking.
  - Requires `status === 'published'`.
  - Requires `runtimeState === 'ended'` (or explicit admin force).
  - Checks for pending judge queue submissions (`status IN ('queued', 'running')`), aborting with 409 if any remain.
  - Computes deterministic official standings, seals `final_results_snapshot` JSONB, and sets `is_rating_finalized = true`.
- **Idempotency**:
  - If called when `is_rating_finalized === true`, immediately commits and returns the existing snapshot and rating history without recalculation.
- **Immutability**:
  - `ContestModel.updateContestWithSafety` locks `isRated`, `leaderboardFreezeEnabled`, and `leaderboardFreezeMinutes` against any mutation once finalized.

---

### 15. Generic Update Bypass Analysis

An audit of [`contestValidation.js`](file:///d:/Secureexamplatform/backend/src/middleware/contestValidation.js) and [`contestModel.js`](file:///d:/Secureexamplatform/backend/src/models/contestModel.js) revealed the following bypasses via `PUT/PATCH /api/contests/:id`:

1. **Direct Status Mutation Bypass**:
   `validateUpdateContest` explicitly validates and permits `status`:
   ```javascript
   const validStatuses = ['draft', 'published', 'archived'];
   if (!validStatuses.includes(status)) { errors.push(...); }
   ```
   When a contest is in `draft` mode:
   - `isLifecycleMutationLocked('draft')` evaluates to `false`.
   - An attacker sending `{"status": "published"}` transitions the contest directly to `published` inside `updateContestWithSafety`.
   - **Bypass**: Completely evades the `publishContestWithSafety` rule requiring at least 1 problem attached to the contest!
2. **Partial Time Update Inconsistency**:
   If an update provides only `startTime` without `endTime`, `validateUpdateContest` does not compare the new `startTime` against the existing `endTime` in the DB. If $startTime > existing\_endTime$, it passes middleware validation and triggers a raw PostgreSQL check constraint violation (`23514`), returning an unhandled 500 error instead of a clean 400.

---

### 16. Concurrency and TOCTOU Analysis

- **Row-Level Locking**:
  All lifecycle mutation methods (`publishContestWithSafety`, `unpublishContestWithSafety`, `archiveContestWithSafety`, `updateContestWithSafety`, `deleteContestWithSafety`, and `finalizeContestRatings`) consistently execute `SELECT ... FOR UPDATE` inside a PostgreSQL transaction (`BEGIN ... COMMIT/ROLLBACK`).
- **TOCTOU Resilience**:
  Even though the controller performs an initial read-only check (`canManageResource`, `getContestRuntimeState`), the service/model re-reads and re-evaluates all lifecycle conditions under the row lock. Concurrent racing requests serialize cleanly.

---

### 17. Database Integrity

- **Constraints**:
  - `contests_status_check`: `CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::text[])))`
  - `check_contest_times`: `CHECK ((end_time > start_time))`
  - Foreign key cascading: `created_by` references `users(id) ON DELETE CASCADE`.
- **Orphan Prevention**:
  `deleteContestWithSafety` explicitly deletes related mappings (`contest_problems`, `contest_participants`) within the transaction before deleting the contest row.

---

### 18. Audit Logging

- **Existing Logged Events**:
  - `CONTEST_CREATED`
  - `CONTEST_UPDATED`
  - `CONTEST_PUBLISHED`
  - `CONTEST_UNPUBLISHED`
  - `CONTEST_ARCHIVED`
  - `CONTEST_DELETED`
  - `RATINGS_FINALIZED`
  - `CONTEST_PROBLEM_ADDED`
  - `CONTEST_PROBLEM_REMOVED`
  - `PRIVILEGED_ACTION_DENIED`
- **Gaps**:
  - Direct status modification via generic update logs `CONTEST_UPDATED` instead of `CONTEST_PUBLISHED` or `CONTEST_UNPUBLISHED`.
  - Automatic time-based transitions generate no log entries (expected for dynamic runtime state).

---

### 19. Frontend vs Server Authority

- **Frontend Controls**:
  - Frontend buttons in `AdminContestManagement.jsx` conditionally hide or disable based on `c.status` and `c.runtimeState`.
  - `AdminContestEditModal.jsx` disables `startTime` and `endTime` when running/ended/archived.
- **Server Authority**:
  - Server endpoints verify authentication, RBAC, ownership, and runtime state independently of any client UI state.

---

### 20. Security Findings

#### SEC-75105-01 (Severity: HIGH)
- **Component**: `backend/src/middleware/contestValidation.js` & `backend/src/models/contestModel.js`
- **Endpoint**: `PUT /api/contests/:id` & `PATCH /api/contests/:id`
- **Attack Path**: An authorized professor or admin submits `{"status": "published"}` via generic update on a draft contest with zero attached problems.
- **Expected Behavior**: Lifecycle transitions between `draft`, `published`, and `archived` must only occur via dedicated lifecycle endpoints (`/publish`, `/unpublish`, `/archive`), ensuring domain validation rules are enforced.
- **Actual Behavior**: Generic update updates `status` directly, allowing a contest with zero problems to be published.
- **Impact**: Incomplete/empty contests can be published and exposed to students.
- **Recommended Fix**: Disallow `status` in `validateUpdateContest` and `updateContestWithSafety`, or strictly delegate status changes to dedicated lifecycle methods.

#### SEC-75105-02 (Severity: MEDIUM)
- **Component**: `backend/src/middleware/contestValidation.js`
- **Endpoint**: `PUT /api/contests/:id` & `PATCH /api/contests/:id`
- **Attack Path**: Updating only `startTime` to a timestamp past the existing `endTime`.
- **Expected Behavior**: Server returns a clean HTTP 400 validation error.
- **Actual Behavior**: Middleware passes; PostgreSQL triggers check violation `23514`, resulting in an unhandled 500 error.
- **Recommended Fix**: Verify cross-field chronological consistency against existing database values when partial updates are submitted.

#### SEC-75105-03 (Severity: MEDIUM)
- **Component**: `backend/src/models/contestModel.js`
- **Endpoint**: `DELETE /api/contests/:id`
- **Attack Path**: A professor deletes an actively running contest before any student has submitted code.
- **Expected Behavior**: Deletion of actively running contests should be blocked (HTTP 409).
- **Actual Behavior**: `deleteContestWithSafety` checks `has_submissions`, but does not check `runtimeState === 'running'`, permitting deletion.
- **Recommended Fix**: Add a check in `deleteContestWithSafety`: if `runtimeState === 'running'`, reject deletion.

#### SEC-75105-04 (Severity: LOW)
- **Component**: `backend/src/services/ratingService.js`
- **Endpoint**: `POST /api/contests/:id/finalize-ratings`
- **Attack Path**: Calling finalize on an already finalized contest that was subsequently archived.
- **Expected Behavior**: Return idempotent cached results snapshot.
- **Actual Behavior**: Fails at step 3 (`status !== 'published'`) with HTTP 400 before reaching the step 4 idempotency check.
- **Recommended Fix**: Move the idempotency check prior to the status check in `ratingService.finalizeContestRatings`.

---

### 21. Recommended Fixes

1. **Remove `status` from generic contest updates**: Require dedicated `/publish`, `/unpublish`, and `/archive` endpoints for lifecycle status transitions.
2. **Add partial timestamp validation**: In `updateContest`, fetch existing `startTime`/`endTime` to validate that new values maintain `end_time > start_time`.
3. **Lock running contests against deletion**: Update `deleteContestWithSafety` to block deletion while `runtimeState === 'running'`.
4. **Order idempotency first in finalization**: Ensure idempotent return works regardless of subsequent archive status.

---

### 22. Existing Controls That Passed

- **Row Locking**: Every lifecycle mutation uses `SELECT ... FOR UPDATE` (PASS).
- **Submission Cutoffs**: Submissions strictly rejected when not running (PASS).
- **Finalization Immutability**: Sealed snapshots and Elo ratings cannot be overwritten (PASS).
- **Professor Ownership**: BOLA checks prevent non-owners from modifying contests (PASS).
- **Draft Isolation**: Unpublished contests remain invisible to students (PASS).

---

### 23. Remaining Risks

- Until generic update restrictions are implemented, authorized professors could inadvertently publish zero-problem contests.
- Deletion of running contests with zero submissions remains possible until patched.

---

### 24. Final Audit Verdict

| Category | Assessment | Status |
|---|---|---|
| State Architecture | Dual-layer (stored status + dynamic runtimeState) | **PASS** |
| Submission Gate | Enforced by `submissionController` across all states | **PASS** |
| Finalization Integrity | Sealed snapshot + transactional rating updates | **PASS** |
| Row-Level Concurrency | `SELECT ... FOR UPDATE` across all mutations | **PASS** |
| Generic Update Status | Bypasses publication problem validation | **GAP** |
| Running Contest Deletion | Allowed when submission count is zero | **GAP** |
| Partial Time Update | Triggers unhandled DB 500 check violation | **GAP** |
