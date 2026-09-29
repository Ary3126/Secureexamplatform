# Phase 7.5.7.7 — Participant Status Management Audit

## 1. Audit Objective

The objective of this audit is to conduct an exhaustive, evidence-based architectural, database, security, and implementation audit of ExamForge's participant management subsystem **BEFORE** writing any code, modifying database schemas, or changing API behaviors for **Phase 7.5.7.7 (Participant Status Management)**.

This audit strictly determines:
1. Whether `contest_participants` currently possesses any status or state field.
2. How participant presence and activity are currently modeled in the database and application code.
3. Which APIs, services, and roles currently interact with participant records.
4. How contest lifecycle states govern participant mutations.
5. How the frontend currently visualizes participant information.
6. What downstream systems (submissions, standings, rating finalization) depend on participant records.
7. What functionality is genuinely missing to support authoritative participant status management (e.g., active, disqualified, withdrawn).

> [!IMPORTANT]
> **CRITICAL RULE COMPLIANCE**: This document represents an **AUDIT ONLY**. In strict compliance with instructions, no source code, database tables, migrations, configurations, endpoints, UI components, or test files have been modified or created during this step.

---

## 2. Repository Areas Inspected

The following areas of the ExamForge repository were inspected:

### Database & Migration Layer
- Live PostgreSQL instance schema for `contest_participants`, `contests`, `users`, `submissions`, `rating_history`, `audit_logs`.
- Database initialization and constraints in [`backend/src/config/initDb.js`](file:///d:/Secureexamplatform/backend/src/config/initDb.js).
- PostgreSQL indexes and foreign key relationship graphs.

### Backend Models & Services
- [`backend/src/models/contestModel.js`](file:///d:/Secureexamplatform/backend/src/models/contestModel.js): Participant creation, deletion, search, and bulk operations.
- [`backend/src/models/userModel.js`](file:///d:/Secureexamplatform/backend/src/models/userModel.js): Student user retrieval and status attributes.
- [`backend/src/services/contestService.js`](file:///d:/Secureexamplatform/backend/src/services/contestService.js): Runtime state calculation, resource management authorization (`canManageResource`), lifecycle mutation locks.
- [`backend/src/services/contestAccessService.js`](file:///d:/Secureexamplatform/backend/src/services/contestAccessService.js): Student eligibility and contest access validation (Phase 7.5.7.6).
- [`backend/src/services/standingsService.js`](file:///d:/Secureexamplatform/backend/src/services/standingsService.js): Leaderboard compilation and participant selection.
- [`backend/src/services/ratingService.js`](file:///d:/Secureexamplatform/backend/src/services/ratingService.js): Elo-based rating calculations and contest finalization.
- [`backend/src/services/auditLogger.js`](file:///d:/Secureexamplatform/backend/src/services/auditLogger.js): Security and governance audit logging.

### Backend Controllers & Routing
- [`backend/src/controllers/contestController.js`](file:///d:/Secureexamplatform/backend/src/controllers/contestController.js): Participant endpoints (`joinContest`, `getMyEnrollmentStatus`, `getContestEligibility`, `getContestParticipants`, `searchContestCandidateStudents`, `addContestParticipant`, `removeContestParticipant`, `bulkAddContestParticipants`, `bulkRemoveContestParticipants`).
- [`backend/src/controllers/submissionController.js`](file:///d:/Secureexamplatform/backend/src/controllers/submissionController.js): Contest submission validation and participation checks.
- [`backend/src/routes/contestRoutes.js`](file:///d:/Secureexamplatform/backend/src/routes/contestRoutes.js): Route mounting, rate limiting, and RBAC middleware.
- [`backend/src/middleware/authMiddleware.js`](file:///d:/Secureexamplatform/backend/src/middleware/authMiddleware.js) & [`backend/src/middleware/roleMiddleware.js`](file:///d:/Secureexamplatform/backend/src/middleware/roleMiddleware.js): Authentication, account deactivation handling, role authorization.

### Frontend UI Components
- [`frontend/src/components/admin/AdminContestParticipantList.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestParticipantList.jsx): Manager participant roster, search, sort, pagination, bulk selection, inspection drawer.
- [`frontend/src/components/admin/AdminContestManagement.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx): Contest dashboard and participant drawer mounting.
- [`frontend/src/components/StudentDashboard.jsx`](file:///d:/Secureexamplatform/frontend/src/components/StudentDashboard.jsx): Student contest display, enrollment buttons, and status indicators.
- [`frontend/src/components/ContestLeaderboard.jsx`](file:///d:/Secureexamplatform/frontend/src/components/ContestLeaderboard.jsx): Contest standings rendering.

### Test Suites & Prior Phase Reports
- Test suites: `backend/test_admin_phase5_7_2_participant_list.js`, `test_admin_phase5_7_3_enrollment.js`, `test_admin_phase5_7_4_manual_participant_mgmt.js`, `test_admin_phase5_7_5_bulk_participants.js`, `test_admin_phase5_7_6_eligibility_access.js`, and corresponding `frontend/test_admin_phase5_7_*_ui.js` files.
- Prior phase reports: `reports/phase_7_5_7_1_report.md` through `reports/phase_7_5_7_6_report.md`.

---

## 3. Existing Participant Status Model

### Direct Database Audit Findings
A direct inspection of PostgreSQL's `information_schema.columns` and `pg_constraint` for table `contest_participants` reveals:

```sql
Table: contest_participants
--------------------------------------------------------------------------------------
Column Name   | Data Type                | Is Nullable | Column Default
--------------------------------------------------------------------------------------
contest_id    | integer                  | NO          | null
user_id       | integer                  | NO          | null
joined_at     | timestamp with time zone | YES         | CURRENT_TIMESTAMP
--------------------------------------------------------------------------------------
Primary Key   : PRIMARY KEY (contest_id, user_id)
Foreign Keys  : contest_id REFERENCES contests(id) ON DELETE CASCADE
                user_id REFERENCES users(id) ON DELETE CASCADE
Indexes       : contest_participants_pkey ON (contest_id, user_id)
                idx_contest_participants_contest ON (contest_id)
                idx_contest_participants_user ON (user_id)
```

### Key Findings
1. **NO STATUS FIELD EXISTS**: The `contest_participants` table does **not** have a `status` column, `state` column, `is_active` column, `is_disqualified` column, or any other status-tracking attribute.
2. **BINARY PARTICIPATION MODEL**: Currently, participant state in ExamForge is strictly binary:
   - **Enrolled**: A row `(contest_id, user_id)` exists in `contest_participants`.
   - **Not Enrolled**: No row exists in `contest_participants`.
3. **NO TIMESTAMPS BEYOND `joined_at`**: There are no `updated_at`, `status_changed_at`, or `disqualified_at` timestamp columns.
4. **NO STATUS REASON COLUMN**: There is no column to record administrative notes or reasons for disqualification/suspension.

---

## 4. Existing Status Values

### Within `contest_participants`
- **Zero status values exist.** Because there is no column on `contest_participants`, no enum, string, or integer status values exist in the database or model for participant records.

### Related Status Fields in Other Tables (Source-of-Truth Check)
The following status fields exist in other tables across the repository, none of which represent participant status:
- **`contests.status`**: Values are `'draft'`, `'published'`, `'archived'` (governs contest lifecycle).
- **`users.rating_status`**: Values are `'provisional'`, `'rated'` (governs student rating maturity; displayed on participant lists as user rating tier).
- **`users.is_active`**: Boolean `true` or `false` (governs global user account suspension; audited in Phase 7.5.7.6).
- **`submissions.status`**: Values are `'queued'`, `'running'`, `'accepted'`, `'wrong_answer'`, `'time_limit_exceeded'`, `'memory_limit_exceeded'`, `'compilation_error'`, `'runtime_error'`.
- **`rating_history.rating_status`**: Values are `'provisional'`, `'rated'`.
- **`problems.review_status`**: Values are `'draft'`, `'pending'`, `'approved'`, `'rejected'`.
- **`system_incidents.status`**: Values are `'OPEN'`, `'RESOLVED'`.

> [!NOTE]
> The rating tier badge rendered in `AdminContestParticipantList.jsx` (`PROV` / `RATED`) displays `u.rating_status` from the `users` table. It indicates whether the student has completed sufficient rated contests platform-wide, **not** their status in the specific contest.

---

## 5. Existing Status Transitions

### Current State
Because no status field exists on `contest_participants`, **no formal participant status transition model was found.**

Currently, the only mutations that alter participant records are:
1. **Enrollment (Row Creation)**: A user transitions from "Unenrolled" to "Enrolled" via `INSERT INTO contest_participants`.
2. **Removal (Row Deletion)**: A user transitions from "Enrolled" to "Unenrolled" via `DELETE FROM contest_participants`.

There is no capability to mark a student as "disqualified", "suspended", "withdrawn", "unrated", or "flagged" while preserving their enrollment or submission history. Currently, the only way to remove someone is permanent database row deletion—which is explicitly blocked if the student has recorded submissions to preserve data integrity.

---

## 6. Transition Matrix

The table below documents the existing participant lifecycle transitions currently supported in ExamForge:

| Current State | Target State | Trigger Operation | Endpoint / Service | Authorization Required | Lifecycle Requirement | Audit Event | Test Suite |
|---|---|---|---|---|---|---|---|
| Unenrolled (no row) | Enrolled (row exists) | Student Self-Enrollment | `POST /api/contests/:id/join` | Student role (`role === 'student'`), Active account | Contest must be `published`, runtimeState must be `upcoming` or `running` | `PARTICIPANT_JOINED` | `test_admin_phase5_7_3_enrollment.js` |
| Unenrolled (no row) | Enrolled (row exists) | Manager Manual Addition | `POST /api/contests/:id/participants` | Super Admin, Contest Admin, Owning Professor (`canManageResource`) | Contest must not be `ended` or `archived` | `PARTICIPANT_ADDED` | `test_admin_phase5_7_4_manual_participant_mgmt.js` |
| Unenrolled (no row) | Enrolled (row exists) | Manager Bulk Addition | `POST /api/contests/:id/participants/bulk` | Super Admin, Contest Admin, Owning Professor (`canManageResource`) | Contest must not be `ended` or `archived` | `BULK_PARTICIPANTS_ADDED` | `test_admin_phase5_7_5_bulk_participants.js` |
| Enrolled (row exists) | Unenrolled (row deleted) | Manager Manual Removal | `DELETE /api/contests/:id/participants/:userId` | Super Admin, Contest Admin, Owning Professor (`canManageResource`) | Contest must not be `ended` or `archived`. **Blocked if submissions exist** | `PARTICIPANT_REMOVED` | `test_admin_phase5_7_4_manual_participant_mgmt.js` |
| Enrolled (row exists) | Unenrolled (row deleted) | Manager Bulk Removal | `DELETE /api/contests/:id/participants/bulk` | Super Admin, Contest Admin, Owning Professor (`canManageResource`) | Contest must not be `ended` or `archived`. **Submissions protected** | `BULK_PARTICIPANTS_REMOVED` | `test_admin_phase5_7_5_bulk_participants.js` |

---

## 7. Participant Endpoints

The repository currently defines 9 participant-related routes in [`backend/src/routes/contestRoutes.js`](file:///d:/Secureexamplatform/backend/src/routes/contestRoutes.js):

### 1. `GET /api/contests/:id/enrollment`
- **Method / Route**: `GET /api/contests/:id/enrollment`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: All authenticated roles
- **Parameters**: `id` (contest ID)
- **Validation**: Positive integer contest ID
- **Authorization**: Own user context (`req.user.id`)
- **Lifecycle Checks**: None (read-only query)
- **DB Mutation**: None (queries `findParticipant`)
- **Audit Logging**: None
- **Rate Limit**: `mediumProtectionRateLimiter` (100 req / 15 min)
- **Tests**: `test_admin_phase5_7_3_enrollment.js`

### 2. `GET /api/contests/:id/eligibility`
- **Method / Route**: `GET /api/contests/:id/eligibility`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: All authenticated roles
- **Parameters**: `id` (contest ID)
- **Validation**: Positive integer contest ID
- **Authorization**: Server-authoritative `req.user.id`; ignores client-supplied `userId`. Draft contests blocked for non-managers with HTTP 403 Forbidden.
- **Lifecycle Checks**: Evaluates `getContestRuntimeState` against server time.
- **DB Mutation**: None (calls `evaluateContestAccessAndEligibility`)
- **Audit Logging**: None
- **Rate Limit**: `mediumProtectionRateLimiter` (100 req / 15 min)
- **Tests**: `test_admin_phase5_7_6_eligibility_access.js`

### 3. `POST /api/contests/:id/join`
- **Method / Route**: `POST /api/contests/:id/join`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: Students only (`req.user.role === 'student'`). Active accounts only (`is_active === true`).
- **Parameters**: `id` (contest ID)
- **Validation**: Positive integer contest ID; prevents duplicate joins (409 Conflict).
- **Authorization**: Students self-enroll; administrative roles blocked with 403.
- **Lifecycle Checks**: Draft contests rejected (400); ended contests rejected (400); archived contests rejected (400); upcoming and running allowed.
- **DB Mutation**: `INSERT INTO contest_participants (contest_id, user_id)`
- **Audit Logging**: `PARTICIPANT_JOINED` on success; `PRIVILEGED_ACTION_DENIED` on forbidden attempts.
- **Rate Limit**: `contestActionRateLimiter` (60 req / 15 min)
- **Tests**: `test_admin_phase5_7_3_enrollment.js`, `test_admin_phase5_7_6_eligibility_access.js`

### 4. `GET /api/contests/:id/participants`
- **Method / Route**: `GET /api/contests/:id/participants`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: `professor`, `contest_admin`, `super_admin`
- **Parameters**: `id` (contest ID), Query: `page`, `limit`, `search`, `sortBy`, `sortOrder`
- **Validation**: Clamped limit (1-100), sanitized sortBy whitelist, integer page.
- **Authorization**: `canManageResource(req.user, contest)` (owning professor, contest admin, super admin).
- **Lifecycle Checks**: None (roster accessible in all lifecycle states).
- **DB Mutation**: None (queries `getContestParticipants` with joined user details).
- **Audit Logging**: `PRIVILEGED_ACTION_DENIED` on unauthorized attempts.
- **Rate Limit**: `mediumProtectionRateLimiter` (100 req / 15 min)
- **Tests**: `test_admin_phase5_7_2_participant_list.js`

### 5. `GET /api/contests/:id/search-students`
- **Method / Route**: `GET /api/contests/:id/search-students`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: `professor`, `contest_admin`, `super_admin`
- **Parameters**: `id` (contest ID), Query: `search`, `limit`
- **Validation**: Clamped limit (max 50), search string.
- **Authorization**: `canManageResource(req.user, contest)`.
- **Lifecycle Checks**: None.
- **DB Mutation**: None (queries active students not currently enrolled).
- **Audit Logging**: None.
- **Rate Limit**: `mediumProtectionRateLimiter` (100 req / 15 min)
- **Tests**: `test_admin_phase5_7_4_manual_participant_mgmt.js`

### 6. `POST /api/contests/:id/participants`
- **Method / Route**: `POST /api/contests/:id/participants`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: `professor`, `contest_admin`, `super_admin`
- **Parameters**: `id` (contest ID), Body: `{ userId }`
- **Validation**: Target user must exist, have role `'student'`, and be active (`is_active === true`).
- **Authorization**: `canManageResource(req.user, contest)` (BOLA defense).
- **Lifecycle Checks**: Rejects `ended` and `archived` contests with 409 Conflict.
- **DB Mutation**: `INSERT INTO contest_participants (contest_id, user_id)`
- **Audit Logging**: `PARTICIPANT_ADDED` on success; `PRIVILEGED_ACTION_DENIED` on failure.
- **Rate Limit**: `contestActionRateLimiter` (60 req / 15 min)
- **Tests**: `test_admin_phase5_7_4_manual_participant_mgmt.js`

### 7. `POST /api/contests/:id/participants/bulk`
- **Method / Route**: `POST /api/contests/:id/participants/bulk`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: `professor`, `contest_admin`, `super_admin`
- **Parameters**: `id` (contest ID), Body: `{ userIds: [...] }`
- **Validation**: Non-empty array, max 100 items. Deduplicates IDs. Filters active students.
- **Authorization**: `canManageResource(req.user, contest)` (BOLA defense).
- **Lifecycle Checks**: Rejects `ended` and `archived` contests with 409 Conflict.
- **DB Mutation**: Batch `INSERT INTO contest_participants ... ON CONFLICT DO NOTHING` inside transaction with row-level lock (`SELECT ... FOR UPDATE`).
- **Audit Logging**: `BULK_PARTICIPANTS_ADDED` with per-item summary.
- **Rate Limit**: `contestActionRateLimiter` (60 req / 15 min)
- **Tests**: `test_admin_phase5_7_5_bulk_participants.js`

### 8. `DELETE /api/contests/:id/participants/bulk` (and aliases)
- **Method / Route**: `DELETE /api/contests/:id/participants/bulk` (also `DELETE /api/contests/:id/participants` and `POST /api/contests/:id/participants/bulk-remove`)
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: `professor`, `contest_admin`, `super_admin`
- **Parameters**: `id` (contest ID), Body: `{ userIds: [...] }`
- **Validation**: Non-empty array, max 100 items.
- **Authorization**: `canManageResource(req.user, contest)`.
- **Lifecycle Checks**: Rejects `ended` and `archived` contests with 409 Conflict.
- **DB Mutation**: Checks for submissions (`SELECT DISTINCT user_id FROM submissions WHERE contest_id = $1 AND user_id = ANY($2)`). Deletes submission-free participants inside transaction.
- **Audit Logging**: `BULK_PARTICIPANTS_REMOVED` with per-item breakdown.
- **Rate Limit**: `contestActionRateLimiter` (60 req / 15 min)
- **Tests**: `test_admin_phase5_7_5_bulk_participants.js`

### 9. `DELETE /api/contests/:id/participants/:userId`
- **Method / Route**: `DELETE /api/contests/:id/participants/:userId`
- **Auth**: Authenticated (`authenticate` middleware)
- **Roles**: `professor`, `contest_admin`, `super_admin`
- **Parameters**: `id` (contest ID), `userId` (student ID)
- **Validation**: Positive integer IDs; verifies participant exists (404).
- **Authorization**: `canManageResource(req.user, contest)`.
- **Lifecycle Checks**: Rejects `ended` and `archived` contests with 409 Conflict.
- **DB Mutation**: Blocks deletion if submissions exist (409 Conflict). Deletes row via `DELETE FROM contest_participants`.
- **Audit Logging**: `PARTICIPANT_REMOVED` on success; `PRIVILEGED_ACTION_DENIED` on unauthorized attempt.
- **Rate Limit**: `contestActionRateLimiter` (60 req / 15 min)
- **Tests**: `test_admin_phase5_7_4_manual_participant_mgmt.js`

> [!WARNING]
> **ENDPOINT GAP**: There is **no endpoint** to inspect or update participant status (e.g. `PATCH /api/contests/:id/participants/:userId/status` or `POST /api/contests/:id/participants/:userId/status` does NOT exist).

---

## 8. Authorization / RBAC

The authorization architecture is centralized in [`contestService.js`](file:///d:/Secureexamplatform/backend/src/services/contestService.js) via `canManageResource(user, contest)`:

```javascript
const canManageResource = (user, resource) => {
  if (!user || resource === undefined || resource === null) return false;
  let creatorId = resource.createdBy !== undefined ? resource.createdBy : resource.created_by;

  // Super Admin & Contest Admin have platform-wide management permissions
  if (user.role === 'super_admin' || user.role === 'contest_admin') {
    return true;
  }

  // Professor can only manage their own creations
  if (user.role === 'professor' && creatorId === user.id) {
    return true;
  }

  return false;
};
```

### Authorization Behavior Verified Across Roles
1. **Super Admin (`super_admin`)**:
   - Authorized to view, add, and remove participants across all contests platform-wide.
2. **Contest Admin (`contest_admin`)**:
   - Authorized to view, add, and remove participants across all contests platform-wide.
3. **Professor (`professor`)**:
   - Authorized **only** for contests created by that professor (`createdBy === user.id`).
   - Attempting to inspect or modify participants of another professor's contest is rejected with **HTTP 403 Forbidden** and audited as `PRIVILEGED_ACTION_DENIED` (Broken Object Level Authorization / BOLA defense).
4. **Student (`student`)**:
   - Strictly forbidden from accessing administrative participant endpoints (HTTP 403 Forbidden).
   - Students can only self-enroll (`POST /:id/join`) into published upcoming/running contests, check their own enrollment status (`GET /:id/enrollment`), and check their own eligibility (`GET /:id/eligibility`).
   - Students cannot modify their own or other students' participant records.
5. **IDOR / BOLA Parameter Tampering Defense**:
   - On student endpoints (`/eligibility`, `/enrollment`), the server uses `req.user.id` strictly and ignores client parameters.
   - On manager endpoints, the server verifies `canManageResource(req.user, contest)` before reading or altering any participant.

---

## 9. Contest Lifecycle Rules

Contest lifecycle is evaluated authoritatively via `getContestRuntimeState(contest)` using the database server's current timestamp:

| Lifecycle State | Contest Status | Time Window | Self-Enrollment (`/join`) | Manager Add (`/participants`) | Manager Remove (`/participants`) | Participant Status Update (Target) | Submissions Allowed |
|---|---|---|---|---|---|---|---|
| **`draft`** | `draft` | Any | ❌ Blocked (400) | ✅ Allowed | ✅ Allowed | To be determined | ❌ Blocked |
| **`upcoming`** | `published` | `now < start_time` | ✅ Allowed (201) | ✅ Allowed | ✅ Allowed | To be determined | ❌ Blocked |
| **`running`** | `published` | `start_time <= now < end_time` | ✅ Allowed (201) | ✅ Allowed | ✅ Allowed (no subs) | To be determined | ✅ Allowed |
| **`ended`** | `published` | `now >= end_time` | ❌ Blocked (400) | ❌ Locked (409) | ❌ Locked (409) | To be determined | ❌ Blocked |
| **`archived`** | `archived` | Any | ❌ Blocked (400) | ❌ Locked (409) | ❌ Locked (409) | To be determined | ❌ Blocked |

### Key Lifecycle Principles Established in Prior Phases
- Participant roster modifications are permitted during `draft`, `upcoming`, and `running` states.
- Once a contest reaches `ended` or `archived` status, all participant additions and removals are strictly locked with **HTTP 409 Conflict** to protect historical academic records.
- For participant status changes (Phase 7.5.7.7), governance rules must define whether a contest manager can disqualify a participant after the contest ends (e.g. following post-contest plagiarism review) or whether ended contests lock status changes as well.

---

## 10. Database Constraints

### Direct Constraints on `contest_participants`
1. **Primary Key**: `PRIMARY KEY (contest_id, user_id)`.
   - Prevents duplicate enrollments of the same student into the same contest at the database level.
2. **Foreign Keys**:
   - `contest_id REFERENCES contests(id) ON DELETE CASCADE`
   - `user_id REFERENCES users(id) ON DELETE CASCADE`
3. **Indexes**:
   - `contest_participants_pkey` on `(contest_id, user_id)` (B-Tree)
   - `idx_contest_participants_contest` on `(contest_id)` (B-Tree)
   - `idx_contest_participants_user` on `(user_id)` (B-Tree)

### Related Constraints on Downstream Tables
1. **`submissions` Table**:
   - `contest_id REFERENCES contests(id) ON DELETE RESTRICT`
   - `user_id REFERENCES users(id)`
   - Note: There is **no composite foreign key** from `submissions(contest_id, user_id)` to `contest_participants(contest_id, user_id)`.
   - To prevent orphaned submissions when participants are deleted, the application layer in Phase 7.5.7.4 and 7.5.7.5 explicitly queries `SELECT 1 FROM submissions WHERE contest_id = $1 AND user_id = $2` before allowing participant row deletion.
2. **`rating_history` Table**:
   - `contest_id REFERENCES contests(id)`
   - `user_id REFERENCES users(id)`

---

## 11. Frontend/UI Behavior

### 1. Admin Participant Management UI ([`AdminContestParticipantList.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestParticipantList.jsx))
- **Table Columns Rendered**:
  1. Multi-select Checkbox (for bulk operations)
  2. Participant (`@username` and `ID #userId`)
  3. Full Name
  4. Email
  5. Institution
  6. Rating (`currentRating` and `ratingStatus` tag `PROV` / `RATED` from `users` table)
  7. Joined At (`joinedAt` timestamp)
  8. Actions (Inspect Details button, Remove button)
- **Current Filter Controls**:
  - Text search bar (searches username, full name, email, institution).
  - Sorting dropdown / column headers (sort by Joined Date, Rating, Username).
  - Pagination controls (Page, Limit 20).
  - **No status filter exists**.
- **Inspection Modal**:
  - Renders student profile details (avatar, username, full name, email, rating, joined date).
  - Explicitly states:
    > `<strong style={{ color: '#94a3b8' }}>Read-Only Inspection:</strong> Participant status and manual modifications are managed in later governance phases.`
- **Action Controls**:
  - "Add Participant" button (triggers candidate search modal).
  - "Bulk Add" / "Bulk Remove" controls.
  - Per-row "Remove" button (triggers confirmation modal with submission protection warning).
  - **No status change dropdown or button exists (e.g., Disqualify, Reinstate, Withdraw).**

### 2. Student Dashboard UI ([`StudentDashboard.jsx`](file:///d:/Secureexamplatform/frontend/src/components/StudentDashboard.jsx))
- Displays contest cards under "Live & Running Contests" and "Upcoming Contests".
- Action badges rendered:
  - **"Enrolled"**: Rendered when `c.isEnrolled === true`.
  - **"Register Now"**: Action button rendered when `!c.isEnrolled`.
  - **"Enter Contest"**: Action button rendered when contest is live.
- **No participant status is displayed to students.** A student cannot see if they are active, disqualified, or under review.

### 3. Clear Distinction of Concepts
- **Participant Status**: The student's individual competitive standing within a specific contest (e.g., active, disqualified, withdrawn). *Currently missing.*
- **Registration / Enrollment Status**: Binary flag indicating whether the student is in `contest_participants` (`isEnrolled: boolean`). *Fully implemented.*
- **Eligibility / Access Status**: Comprehensive evaluation of account active state, role, contest publication, and lifecycle state (`canRegister`, `canParticipate`, `allowed`, `eligible`). *Fully implemented in Phase 7.5.7.6.*

---

## 12. Previous Phase Integration

A review of reports and implementations across Phase 7.5.7:

1. **Phase 7.5.7.1 — Architecture & Audit**:
   - Identified that `contest_participants` lacks a status field and that participants cannot be disqualified without deleting their database row.
   - Slated status management and disqualification for Sub-Phase 7.5.7.7.
2. **Phase 7.5.7.2 — Participant List & Discovery**:
   - Implemented paginated, searchable, sortable `GET /api/contests/:id/participants`.
   - Built `<AdminContestParticipantList />` with strict BOLA defense.
3. **Phase 7.5.7.3 — Student Enrollment / Registration**:
   - Hardened `POST /api/contests/:id/join` and `GET /api/contests/:id/enrollment`.
   - Caught unique constraint race conditions (`23505`) and returned clean 409 Conflict.
4. **Phase 7.5.7.4 — Manual Participant Management**:
   - Implemented single manual add (`POST /:id/participants`) and remove (`DELETE /:id/participants/:userId`).
   - Protected historical submissions: participants with submissions cannot be deleted (409 Conflict).
5. **Phase 7.5.7.5 — Bulk Participant Operations**:
   - Implemented batch addition (`POST /:id/participants/bulk`) and batch removal (`DELETE /:id/participants/bulk`).
   - Enforced transaction row-level locking, deduplication, batch limits (100 items), and submission protection.
6. **Phase 7.5.7.6 — Eligibility & Access Validation**:
   - Implemented `contestAccessService.js` and `GET /api/contests/:id/eligibility`.
   - Delineated Student Eligibility vs Contest Access.
   - Enforced active student account checks across self-enrollment and manager additions.

---

## 13. Existing Tests

The repository currently maintains 10 dedicated participant management test suites:

### Backend Integration Suites
1. **`backend/test_admin_phase5_7_2_participant_list.js`**: 35 tests (authentication, RBAC, BOLA, search, sorting, pagination, credential exclusion).
2. **`backend/test_admin_phase5_7_3_enrollment.js`**: 25 tests (authentication, role checks, lifecycle restrictions, concurrency races, mass assignment protection).
3. **`backend/test_admin_phase5_7_4_manual_participant_mgmt.js`**: 41 tests (manual add, manual remove, candidate search, BOLA, submission protection, lifecycle locks).
4. **`backend/test_admin_phase5_7_5_bulk_participants.js`**: 45 tests (bulk add, bulk remove, deduplication, mixed batches, transaction safety, submission preservation).
5. **`backend/test_admin_phase5_7_6_eligibility_access.js`**: 33 tests (eligibility evaluation, access validation, draft BOLA, IDOR parameter defense, unit edge cases).

### Frontend UI Suites
6. **`frontend/test_admin_phase5_7_2_participant_list_ui.js`**: 22 tests (roster rendering, sorting, pagination, error states).
7. **`frontend/test_admin_phase5_7_3_enrollment_ui.js`**: 14 tests (button states, spinner loading, 409 already enrolled, error banners).
8. **`frontend/test_admin_phase5_7_4_manual_participant_mgmt_ui.js`**: 26 tests (add modal, candidate selection, remove confirmation, submission warnings).
9. **`frontend/test_admin_phase5_7_5_bulk_participants_ui.js`**: 27 tests (multi-select roster, candidate selection, bulk summaries, batch limits).
10. **`frontend/test_admin_phase5_7_6_eligibility_access_ui.js`**: 11 tests (dynamic action buttons, badges, draft restriction alerts, immutability).

### Status Test Findings
- **Total Existing Tests**: 279 automated tests across Phase 7.5.7.
- **Pass Rate**: 100% (279 passed, 0 failed).
- **Participant Status Coverage**: **0 tests**. There are currently no tests testing participant status values, status transitions, invalid status changes, unauthorized status updates, or downstream status effects.

---

## 14. Security Audit

Potential security gaps and considerations specifically relating to participant status:

1. **BOLA / IDOR on Status Modification**:
   - Risk: A malicious professor updating participant status on a contest owned by another professor.
   - Requirement: Must enforce `canManageResource(req.user, contest)` before permitting status transitions.
2. **Privilege Escalation**:
   - Risk: A student attempting to reinstate themselves after disqualification or altering another student's status.
   - Requirement: Endpoints must be strictly restricted to `professor`, `contest_admin`, and `super_admin`.
3. **Arbitrary Status Value Injection**:
   - Risk: A client sending arbitrary or unvalidated strings (e.g., `status: 'super_winner'` or SQL payloads).
   - Requirement: Strict input validation against a strict whitelist of allowed statuses, backed by a PostgreSQL `CHECK` constraint.
4. **Mass Assignment Vulnerability**:
   - Risk: Attackers passing `status` during self-enrollment (`POST /:id/join`) or participant creation.
   - Requirement: Status must default to initial value (e.g. `'registered'`) during creation; client-provided status fields in creation payloads must be ignored.
5. **Lifecycle Bypass**:
   - Risk: Altering participant status after a contest is archived.
   - Requirement: Explicit lifecycle rules defining when status transitions are permitted.
6. **Audit Trail Evasion**:
   - Risk: Administrative disqualifications occurring without accountability or reason.
   - Requirement: All status transitions must generate structured audit logs with actor ID, target user ID, old status, new status, and reason.

---

## 15. Data Integrity Audit

Examining downstream impacts of participant status:

1. **Submissions Subsystem**:
   - Currently, `submissionController.js` lines 51-60 checks:
     `const participant = await ContestModel.findParticipant(contestId, userId);`
   - If a participant is marked `'disqualified'`, this check currently passes because the row exists! Disqualified participants would still be able to submit solutions unless `findParticipant` or `submissionController` inspects participant status.
2. **Standings / Leaderboard Subsystem**:
   - Currently, `standingsService.js` lines 86-100 queries:
     `SELECT ... FROM contest_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.contest_id = $1`
   - Disqualified participants would currently appear on the public leaderboard. The leaderboard calculation must handle disqualified participants (e.g., exclude from ranks, flag with disqualification tag, or zero their score).
3. **Rating Calculation Subsystem**:
   - `ratingService.js` calculates Elo rating changes based on participants returned by `StandingsService`.
   - If a disqualified participant is included, their results distort the expected scores and rating changes of all other honest participants in the contest. Disqualified participants must be excluded from official rating changes.
4. **Soft Deletion vs Deletion**:
   - Phase 7.5.7.4 established that participants who submitted code cannot be deleted (`DELETE FROM contest_participants`) to prevent orphan submissions.
   - Participant status provides the ideal architectural solution: instead of hard deleting a participant with submissions, an administrator can change their status to `'disqualified'` or `'withdrawn'`, preserving the historical audit and submission trail while disabling active participation.

---

## 16. Concurrency Audit

Concurrency scenarios to evaluate for participant status management:

1. **Simultaneous Status Updates (Admin A vs Admin B)**:
   - Scenario: Admin A sets participant to `'disqualified'` while Admin B sets participant to `'active'`.
   - Risk: Lost updates or inconsistent audit records.
   - Solution: PostgreSQL transactions with row-level locking (`SELECT ... FROM contest_participants WHERE contest_id = $1 AND user_id = $2 FOR UPDATE`).
2. **Status Update vs Participant Removal Race**:
   - Scenario: Admin A attempts to update status while Admin B deletes the participant.
   - Solution: Row lock will serialize the requests; the second request will detect that the participant no longer exists and return HTTP 404 Not Found.
3. **Contest Lifecycle Race (Finalization vs Status Update)**:
   - Scenario: Admin disqualifies a participant at the exact moment ratings are being finalized.
   - Solution: Locking the contest row prevents finalization from executing concurrently with participant status modifications.
4. **Idempotent Status Requests**:
   - Scenario: The same status update request is submitted multiple times.
   - Behavior: If status is already equal to target status, return HTTP 200 OK with message that status is already set.

---

## 17. Performance Observations

1. **Table Volume**:
   - `contest_participants` contains 1 row per enrolled student per contest. For 1,000 active students and 100 contests, this table contains ~10,000 to ~100,000 rows.
2. **Index Requirements for Status**:
   - Adding a `status` column will require composite indexing if filtered frequently in standings:
     `CREATE INDEX idx_contest_participants_status ON contest_participants(contest_id, status)`
   - This ensures $O(\log N)$ seeks when querying active participants for leaderboard generation.
3. **Admin Roster Queries**:
   - `getContestParticipants` in `contestModel.js` will need to select the status column and support filtering by status (e.g., `WHERE cp.status = $X`).

---

## 18. Existing Functionality

The following participant-related capabilities exist and are fully functional:
- ✅ Database table `contest_participants` with composite primary key `(contest_id, user_id)`.
- ✅ Authenticated student self-enrollment (`POST /api/contests/:id/join`).
- ✅ Authenticated enrollment status check (`GET /api/contests/:id/enrollment`).
- ✅ Authoritative eligibility & access evaluation (`GET /api/contests/:id/eligibility`).
- ✅ Paginated, searchable, sortable participant roster (`GET /api/contests/:id/participants`).
- ✅ Candidate student search for unenrolled active students (`GET /api/contests/:id/search-students`).
- ✅ Manager single manual participant addition (`POST /api/contests/:id/participants`).
- ✅ Manager single manual participant removal with submission protection (`DELETE /api/contests/:id/participants/:userId`).
- ✅ Manager bulk participant addition with row-locking and batch deduplication (`POST /api/contests/:id/participants/bulk`).
- ✅ Manager bulk participant removal with submission protection (`DELETE /api/contests/:id/participants/bulk`).
- ✅ Strict BOLA defense via `canManageResource(user, contest)`.
- ✅ Contest lifecycle mutation locks (ended and archived contests lock additions/removals).
- ✅ Structured security audit logging (`PARTICIPANT_JOINED`, `PARTICIPANT_ADDED`, `PARTICIPANT_REMOVED`, `BULK_PARTICIPANTS_ADDED`, `BULK_PARTICIPANTS_REMOVED`, `PRIVILEGED_ACTION_DENIED`).
- ✅ Rate limiting on all participant endpoints.
- ✅ Admin UI table in `<AdminContestParticipantList />` with candidate addition, remove modals, and bulk action bars.

---

## 19. Partial Functionality

The following areas have partial scaffolding or indirect connections but lack full implementation:
- ⚠️ **Inspection Drawer Notice**: `AdminContestParticipantList.jsx` line 1417 contains a placeholder note: *"Participant status and manual modifications are managed in later governance phases."* The UI drawer structure exists, but status controls are absent.
- ⚠️ **Rating Tier vs Participant Status Confusion**: `users.rating_status` is displayed in the participant table, which can be misconstrued as contest participant status.
- ⚠️ **Submission Check in `submissionController.js`**: Checks `findParticipant`, but since all enrolled participants are treated identically, it cannot block enrolled students who have been disqualified.
- ⚠️ **Standings Participant Inclusion**: Standings service queries all student participants without status filtering.

---

## 20. Missing Functionality

The following functionality is genuinely missing and required for Phase 7.5.7.7:

1. **Database Schema Column**:
   - `contest_participants` table does not have a `status` column.
   - Missing: A migration/DDL statement adding `status` (e.g. `VARCHAR(20) NOT NULL DEFAULT 'registered' CHECK (status IN (...))`).
   - Missing: A column for `status_reason` (TEXT) or `updated_at` (TIMESTAMPTZ) to track why and when status changed.
2. **Backend Model Methods**:
   - `contestModel.js` lacks `updateParticipantStatus(contestId, userId, newStatus, reason, actor)`.
   - `contestModel.js` lacks status filtering in `getContestParticipants(contestId, options)` (e.g. `options.status`).
3. **Backend Status Transition Logic**:
   - No service or validator defining legal status transitions (e.g., state machine rules).
4. **Backend API Endpoint**:
   - No route or controller method for updating participant status (e.g., `PATCH /api/contests/:id/participants/:userId/status`).
5. **Downstream Enforcement**:
   - `submissionController.js`: Does not reject submissions from disqualified participants.
   - `standingsService.js`: Does not exclude or annotate disqualified participants on the leaderboard.
   - `ratingService.js`: Does not exclude disqualified participants from Elo rating recalculation.
6. **Audit Logging**:
   - No `PARTICIPANT_STATUS_UPDATED` or `PARTICIPANT_DISQUALIFIED` audit action.
7. **Frontend UI Status Controls**:
   - `AdminContestParticipantList.jsx` lacks:
     - Status column in the participant table with colored status badges.
     - Status filter dropdown in the table toolbar.
     - Status change action (e.g., "Change Status" button or dropdown in row actions).
     - Status change confirmation modal with status selection and required reason field.
8. **Student-Facing Status Display**:
   - `StudentDashboard.jsx` does not indicate if an enrolled student has been disqualified or has a specific participation status.
9. **Automated Tests**:
   - Zero tests exist for participant status management.

---

## 21. Security Gaps

Identified security requirements that must be strictly addressed during Phase 7.5.7.7 implementation:
- **BOLA Defense**: Only owning professors, contest admins, and super admins can modify participant status. Non-owning professors must be blocked with HTTP 403 Forbidden.
- **Student Authorization**: Students must never be permitted to alter participant status (HTTP 403 Forbidden).
- **Status Value Validation**: Target status must be validated against a strict whitelist; invalid values must return HTTP 400 Bad Request.
- **Mandatory Reason on Disqualification**: Administrative disqualifications must require an explanation reason to prevent unaccountable or accidental actions.
- **Audit Logging**: Every status transition must generate an immutable audit record in `audit_logs`.

---

## 22. Testing Gaps

To ensure full stability, the following tests must be created when Phase 7.5.7.7 is implemented:
1. **Backend Integration Tests**:
   - Authentication check (401 for unauthenticated status update).
   - RBAC check (403 for student role).
   - BOLA check (403 for non-owning professor).
   - Authorized roles (200 for contest admin, super admin, owning professor).
   - Input validation (400 for invalid contest ID, invalid user ID, missing/invalid status).
   - Participant existence check (404 for nonexistent participant).
   - Lifecycle restrictions (behavior in draft, upcoming, running, ended, archived).
   - Legal vs illegal transitions.
   - Submissions rejection for disqualified participants (403 Forbidden).
   - Standings and rating impact for disqualified participants.
   - Concurrency safety during status updates.
   - Audit logging verification (`PARTICIPANT_STATUS_UPDATED`).
2. **Frontend UI Tests**:
   - Status badge rendering for each status.
   - Status filter dropdown functionality.
   - Status change modal workflow, reason validation, loading states, and error handling.
   - Dynamic disablement based on RBAC and lifecycle locks.

---

## 23. Recommended Minimal Implementation

Based exclusively on repository findings and requirements, the recommended minimal implementation for Phase 7.5.7.7 is:

### 1. Database Schema (Minimal & Safe)
- Add `status VARCHAR(20) NOT NULL DEFAULT 'registered'` to `contest_participants`.
- Add `CHECK (status IN ('registered', 'active', 'disqualified', 'withdrawn'))` constraint.
- Add `status_reason TEXT DEFAULT NULL` to store administrative justification.
- Add `updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` to track transition time.
- Add index: `CREATE INDEX idx_contest_participants_status ON contest_participants(contest_id, status)`.

### 2. Status Values Definition (Minimal & Evidence-Based)
In accordance with references in `phase_7_5_7_1_report.md`:
- **`registered`**: Default state upon enrollment. Participant is eligible to participate when the contest starts.
- **`active`**: Participant has entered the contest or submitted code.
- **`disqualified`**: Participant has been disqualified by an administrator (violates academic integrity, cheating, etc.). Blocked from submitting; excluded from rating calculations; annotated on leaderboard.
- **`withdrawn`**: Participant has withdrawn or been administratively removed from active competition without penalty.

### 3. Backend Implementation
- Add `updateParticipantStatus(contestId, userId, newStatus, reason, actorUser, req)` in `contestModel.js`.
- Add `updateParticipantStatus` controller method in `contestController.js`.
- Mount `PATCH /api/contests/:id/participants/:userId/status` in `contestRoutes.js` with `authenticate`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, and rate limiting.
- Update `submissionController.js` to verify participant status is not `'disqualified'` before accepting solutions.
- Update `StandingsService` to flag or handle disqualified participants.
- Emit `PARTICIPANT_STATUS_UPDATED` in `auditLogger.js`.

### 4. Frontend UI Implementation
- In `AdminContestParticipantList.jsx`:
  - Add Status column to table with colored status badges (`Registered` - blue, `Active` - green, `Disqualified` - red, `Withdrawn` - gray).
  - Add Status filter dropdown in header toolbar (`All Statuses`, `Registered`, `Active`, `Disqualified`, `Withdrawn`).
  - Add "Change Status" option in participant action controls.
  - Implement a dedicated "Change Participant Status" modal with status selector and required reason input.

---

## 24. Out of Scope

The following features are explicitly out of scope for Phase 7.5.7.7:
- Automated AI proctoring or automated cheat detection triggers (reserved for Secure Examination Phase 8).
- Webcam, microphone, or browser lockdown enforcement.
- Automated code similarity / plagiarism detection engines.
- Redesigning the full public leaderboard (Phase 7.5.8).
- Rating system algorithm overhauls (Phase 7.5.9).

---

## 25. Audit Conclusion

The architecture and implementation audit for **Phase 7.5.7.7 — Participant Status Management** is complete.

### Summary of Baseline Findings
1. `contest_participants` currently possesses **no status column**; enrollment is purely binary.
2. No participant status transition model exists; participants can only be added or deleted.
3. Participants who have submitted code cannot be deleted to protect historical data, creating an operational requirement for status-based disqualification/deactivation.
4. Existing RBAC (`canManageResource`), BOLA protections, lifecycle state engine, audit logger, and frontend table structures provide a robust foundation for integrating participant status.
5. Zero tests currently cover participant status.

The repository is fully ready for Phase 7.5.7.7 implementation planning upon user instruction.
