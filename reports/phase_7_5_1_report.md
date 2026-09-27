# Phase 7.5.1 — Contest Management Architecture & Audit

## Phase
- **Project**: ExamForge — Coding Practice, Competitive Programming & Secure Examination Platform
- **Phase**: Phase 7 — Admin Panel V1 Re-development
- **Sub-Phase**: Phase 7.5.1 — Contest Management Architecture & Audit
- **Status**: Complete

---

## Goal
Establish the architectural blueprint, comprehensive technical audit, and implementation roadmap for the Admin Contest Management system within the ExamForge Admin Panel.

This sub-phase is strictly an **AUDIT + ARCHITECTURE** phase. It discovers and audits all existing contest-related components (database schemas, APIs, controllers, services, models, validation, lifecycle locks, authorization rules, contest-problem relationships, participants, leaderboard, submissions, ratings, security, and automated tests) to ensure **MAXIMUM REUSE** and **ZERO DUPLICATION**.

---

## Existing Contest Architecture

ExamForge possesses a mature, battle-tested contest infrastructure initially developed during Phase 3, hardened with Elo rating systems in Phase 5.4, enhanced with live frozen standings in Phase 5.5, and safeguarded with transactional lifecycle locks, problem mutation locks, and deletion protections in Phase 5.9.2.

The high-level architecture flows as follows:

```
┌────────────────────────────────────────────────────────────────────────┐
│                               FRONTEND                                 │
│  - AdminPanel.jsx (mounts ContestsSection)                            │
│  - AdminContestManagement.jsx (contest discovery & listing)           │
│  - ContestManagementCard.jsx (readiness check card)                   │
│  - StudentDashboard.jsx (contest discovery & card views)             │
│  - ContestLeaderboard.jsx (live standings, problem scoreboard)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST (JWT Auth)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              API ROUTES                                │
│  - backend/src/routes/contestRoutes.js (/api/contests)                 │
│    * Public/Optional Auth: GET /, GET /:id, GET /:id/leaderboard       │
│    * Student/User Auth: POST /:id/join                                 │
│    * Admin/Manager Auth: POST /, PUT /:id, PATCH /:id, DELETE /:id,   │
│                          POST /:id/publish, POST /:id/problems,        │
│                          POST /:id/problems/bulk, PUT /:id/problems,   │
│                          DELETE /:id/problems, DELETE /:id/problems/:pid│
│                          GET /:id/participants, POST /:id/finalize-ratings
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                             CONTROLLERS                                │
│  - contestController.js (14 controller methods)                        │
│  - submissionController.js (contest verification, participant gate)    │
└───────────────────┬───────────────────────────────┬────────────────────┘
                    │                               │
                    ▼                               ▼
┌───────────────────────────────────────┐ ┌──────────────────────────────┐
│               SERVICES                │ │            MODELS            │
│ - contestService.js (runtimeState,    │ │ - contestModel.js (CRUD,     │
│   lifecycle & problem locks, RBAC)    │ │   SELECT FOR UPDATE locks,   │
│ - standingsService.js (scoreboard,    │ │   bulk operations, mappings) │
│   freeze cutoff, tie-breaking)        │ │ - problemModel.js            │
│ - ratingService.js (multi-party Elo,  │ │ - submissionModel.js         │
│   rating deltas, finalization)        │ │ - ratingModel.js             │
│ - auditLogger.js (structured logging) │ │                              │
└───────────────────┬───────────────────┘ └──────────────┬───────────────┘
                    │                                    │
                    └─────────────────┬──────────────────┘
                                      │ PostgreSQL Pool
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              DATABASE                                  │
│  - contests                                                            │
│  - contest_problems                                                    │
│  - contest_participants                                                │
│  - submissions (contest_id FK)                                         │
│  - rating_history                                                      │
│  - leaderboard_snapshots                                               │
│  - audit_logs                                                          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Database Architecture

A live audit of the PostgreSQL database (`secure_exam_db`) confirms the exact structure of all contest-related tables:

### 1. `contests` Table
Stores contest master metadata and configuration.

| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | integer | NO | `nextval('contests_id_seq')` | Primary Key |
| `title` | character varying | NO | null | Contest title (3-200 chars) |
| `description` | text | YES | null | Detailed contest instructions/description |
| `created_by` | integer | NO | null | Foreign Key -> `users(id)` |
| `start_time` | timestamptz | NO | null | Authoritative contest start timestamp |
| `end_time` | timestamptz | NO | null | Authoritative contest end timestamp |
| `status` | character varying | NO | `'draft'` | Lifecycle status: `'draft'`, `'published'`, `'archived'` |
| `is_rated` | boolean | NO | `true` | Whether contest affects competitive Elo ratings |
| `is_rating_finalized` | boolean | NO | `false` | True if ratings have been calculated & committed |
| `ratings_finalized_at` | timestamptz | YES | null | Timestamp when ratings were finalized |
| `leaderboard_freeze_enabled` | boolean | NO | `false` | Enables scoreboard masking before contest end |
| `leaderboard_freeze_minutes` | integer | NO | `60` | Number of minutes before end time when freeze begins |
| `created_at` | timestamptz | YES | `CURRENT_TIMESTAMP` | Row creation timestamp |
| `updated_at` | timestamptz | YES | `CURRENT_TIMESTAMP` | Row last updated timestamp |

- **Primary Key**: `contests_pkey` (`id`)
- **Foreign Keys**: `created_by` -> `users(id)`
- **Indexes**:
  - `idx_contests_created_by` ON `contests(created_by)`
  - `idx_contests_status` ON `contests(status)`
  - `idx_contests_times` ON `contests(start_time, end_time)`

### 2. `contest_problems` Table
Many-to-many relationship mapping problems to contests with points and display order.

| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `contest_id` | integer | NO | null | Foreign Key -> `contests(id)` |
| `problem_id` | integer | NO | null | Foreign Key -> `problems(id)` |
| `problem_order` | integer | NO | `1` | Display sequence order within contest |
| `points` | integer | NO | `100` | Maximum points awarded for problem in contest |

- **Primary Key**: `contest_problems_pkey` (`contest_id`, `problem_id`)
- **Foreign Keys**:
  - `contest_id` -> `contests(id)`
  - `problem_id` -> `problems(id)`
- **Indexes**:
  - `idx_contest_problems_contest` ON `contest_problems(contest_id)`
  - `idx_contest_problems_problem` ON `contest_problems(problem_id)`

### 3. `contest_participants` Table
Records participant registration and enrollment in contests.

| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `contest_id` | integer | NO | null | Foreign Key -> `contests(id)` |
| `user_id` | integer | NO | null | Foreign Key -> `users(id)` |
| `joined_at` | timestamptz | YES | `CURRENT_TIMESTAMP` | Timestamp when user enrolled |

- **Primary Key**: `contest_participants_pkey` (`contest_id`, `user_id`)
- **Foreign Keys**:
  - `contest_id` -> `contests(id)`
  - `user_id` -> `users(id)`
- **Indexes**:
  - `idx_contest_participants_contest` ON `contest_participants(contest_id)`
  - `idx_contest_participants_user` ON `contest_participants(user_id)`

### 4. `submissions` Table Integration
The `submissions` table already has dedicated columns and indexes for contest binding:
- `contest_id`: integer, nullable, FK -> `contests(id)`
- Index: `idx_submissions_contest_id` ON `submissions(contest_id)`
- Composite Index: `idx_submissions_contest_user_status` ON `submissions(contest_id, user_id, status, is_sample_run)`
- Performance Index: `idx_submissions_perf_analytics` on `(problem_id, lower(language), contest_id)`

### 5. `rating_history` Table
Stores immutable historical rating changes per user per contest.
- Columns: `id`, `user_id`, `contest_id`, `previous_rating`, `rating_change`, `new_rating`, `rank`, `participant_count`, `performance_rating`, `rating_status`, `created_at`.
- Unique Index: `uq_rating_history_user_contest` ON `(user_id, contest_id)` (prevents double-rating).

### Database Audit Conclusion:
**NO NEW DATABASE TABLES ARE NEEDED.** The schema fully supports every functional requirement for Phase 7.5 Contest Management.

---

## Existing APIs

All contest APIs are centralized in `backend/src/routes/contestRoutes.js` and mounted on `/api/contests`.

| HTTP Method | Route | Auth / RBAC | Rate Limiter | Controller Action | Purpose |
|---|---|---|---|---|---|
| `GET` | `/api/contests/:id/leaderboard` | Optional Auth (Public/Guest allowed) | Medium | `getContestLeaderboard` | Standings matrix, scores, penalties, freeze masking |
| `GET` | `/api/contests` | Optional Auth (Filter by status/state) | Medium | `getAllContests` | List contests; drafts filtered out for non-managers |
| `GET` | `/api/contests/:id` | Optional Auth (IDOR check on drafts) | Medium | `getContestById` | Contest details + attached problems & points |
| `POST` | `/api/contests` | Authenticated: `professor`, `contest_admin`, `super_admin` | Action | `createContest` | Create contest in `'draft'` mode |
| `PUT` | `/api/contests/:id` | Authenticated: Manager/Owner | Action | `updateContest` | Full update; lifecycle locked if running/ended |
| `PATCH` | `/api/contests/:id` | Authenticated: Manager/Owner | Action | `updateContest` | Partial update (archive, etc.); locked if running/ended |
| `DELETE` | `/api/contests/:id` | Authenticated: Manager/Owner | Action | `deleteContest` | Delete contest; blocked with 409 if submissions exist |
| `POST` | `/api/contests/:id/publish` | Authenticated: Manager/Owner | Action | `publishContest` | Transition draft -> published; requires >=1 problem |
| `POST` | `/api/contests/:id/problems` | Authenticated: Manager/Owner | Action | `addProblemToContest` | Attach problem with points & order; locked if running |
| `POST` | `/api/contests/:id/problems/bulk` | Authenticated: Manager/Owner | Action | `bulkAddProblemsToContest` | Bulk attach/replace problems; locked if running |
| `PUT` | `/api/contests/:id/problems` | Authenticated: Manager/Owner | Action | `bulkAddProblemsToContest` | Bulk alias; locked if running |
| `DELETE` | `/api/contests/:id/problems` | Authenticated: Manager/Owner | Action | `bulkRemoveProblemsFromContest`| Bulk detach problems; locked if running |
| `DELETE` | `/api/contests/:contestId/problems/:problemId` | Authenticated: Manager/Owner | Action | `removeProblemFromContest` | Detach single problem; locked if running |
| `POST` | `/api/contests/:id/join` | Authenticated: Any user (student) | Action | `joinContest` | Enroll in published contest |
| `GET` | `/api/contests/:id/participants` | Authenticated: Manager/Owner | Medium | `getContestParticipants` | Enrolled participant list with timestamps |
| `POST` | `/api/contests/:id/finalize-ratings` | Authenticated: Manager/Owner | Action | `finalizeContestRatings` | Calculate & commit Elo rating deltas for ended contest |

---

## Existing Controllers

### `backend/src/controllers/contestController.js` (963 lines)
Contains 14 well-defined controller handlers:
1. `createContest`: Sanitizes payload, binds `createdBy = req.user.id`, calls `ContestModel.createContestWithSafety`.
2. `getAllContests`: Handles `status`, `state` (upcoming/running/ended), pagination (`limit`, `offset`), and filters draft contests for unprivileged users.
3. `getContestById`: Returns formatted contest with attached problem list; enforces draft invisibility for unauthorized users.
4. `updateContest`: Validates ownership via `canManageResource`, checks lifecycle lock, executes `ContestModel.updateContestWithSafety`.
5. `deleteContest`: Enforces ownership, checks for existing submissions, deletes dependent mappings in atomic transaction.
6. `publishContest`: Validates ownership, checks contest is in `'draft'` state, ensures at least one problem is attached, publishes atomically.
7. `addProblemToContest`: Enforces ownership before lifecycle checks (preventing state leak), ensures contest is not locked, checks problem existence, prevents duplicates (409), inserts mapping.
8. `removeProblemFromContest`: Enforces ownership and lifecycle lock, removes mapping from `contest_problems`.
9. `bulkAddProblemsToContest`: Bulk inserts or updates problem points/orders with `ON CONFLICT (contest_id, problem_id) DO UPDATE`.
10. `bulkRemoveProblemsFromContest`: Removes specified problem IDs or clears all problems from draft contest.
11. `joinContest`: Enforces that contest is published and not ended, prevents duplicate join with 409 Conflict, creates enrollment.
12. `getContestParticipants`: Retrieves enrolled student participant list, enrollment count, and timestamps for contest managers.
13. `finalizeContestRatings`: Delegates to `RatingService.finalizeContestRatings` with contest ownership check.
14. `getContestLeaderboard`: Delegates to `StandingsService.computeContestStandings` with pagination, search, and manager freeze override.

---

## Existing Services

1. **`contestService.js`**:
   - `getContestRuntimeState(contest)`: Authoritative calculation of `'draft'`, `'archived'`, `'upcoming'`, `'running'`, `'ended'` using server clock.
   - `isLifecycleMutationLocked(runtimeState)`: Returns true for `'running'`, `'ended'`, `'archived'`.
   - `getLifecycleLockMessage(runtimeState)`: Structured conflict message.
   - `getProblemMutationLockMessage(runtimeState)`: Structured problem conflict message.
   - `canManageResource(user, resource)`: Strict RBAC check (super_admin & contest_admin platform-wide; professor owner-only).
   - `formatContest(contest)`: Standardizes camelCase payload format and injects server-computed `runtimeState`.

2. **`standingsService.js`**:
   - Single source of truth for contest standings, problem matrix scores, penalty minutes, tie-breaking, freeze cutoff, and pagination.
   - Respects `leaderboardFreezeEnabled` and `leaderboardFreezeMinutes`.

3. **`ratingService.js`**:
   - Multi-participant pairwise Elo rating engine.
   - Calculates rating changes, updates user records, writes immutable `rating_history`, and marks contest ratings as finalized.

4. **`auditLogger.js`**:
   - Persists tamper-evident records to `audit_logs` for all contest lifecycle events, problem mutations, deletions, and access denials.

---

## Existing Models

### `backend/src/models/contestModel.js` (904 lines)
- Encapsulates direct database queries.
- Uses transaction clients (`client.query('BEGIN')` ... `COMMIT` / `ROLLBACK`).
- Implements pessimistic concurrency control (`SELECT ... FOR UPDATE`) on contest rows to prevent race conditions during updates, problem attachments, publishing, and deletions.
- Implements `hasSubmissions(contestId)` using efficient `SELECT EXISTS`.
- Implements bulk operations with `ON CONFLICT DO UPDATE`.

---

## Existing Validation

In `backend/src/middleware/contestValidation.js`:
- `validateCreateContest`:
  - `title`: String, 3 to 200 characters.
  - `startTime`: Valid ISO 8601 string.
  - `endTime`: Valid ISO 8601 string, strictly after `startTime`.
  - `description`: Optional text string.
- `validateUpdateContest`:
  - Optional fields: `title`, `startTime`, `endTime`, `description`, `isRated`, `leaderboardFreezeEnabled`, `leaderboardFreezeMinutes`, `status`.
  - Date sanity: `endTime > startTime`.
  - Requires at least one field to update.
- `validateAddProblemToContest`:
  - `problemId`: Positive integer.
  - `problemOrder`: Optional positive integer.
  - `points`: Optional positive integer.

### Validation Audit Gaps:
- Freeze minutes: No validation ensuring `leaderboardFreezeMinutes` does not exceed contest duration.
- Duration bounds: No minimum duration (e.g. >= 5 mins) or maximum duration (e.g. <= 30 days) validation.
- Bulk problem payload: Controller performs array check, but no formal middleware exists in `contestValidation.js`.

---

## Existing Authorization

ExamForge RBAC follows the 4-tier model:
- **`student`**: Read published contests, join published contests, view public leaderboard, submit solutions. No managerial permissions.
- **`professor`**: Author contests (starts in draft), update/publish/delete owned contests, manage problems in owned contests, view participants in owned contests, finalize ratings for owned contests. Cannot access or modify other professors' contests.
- **`contest_admin`**: Platform-wide contest manager. Can create, edit, publish, archive, delete ANY contest, manage problems in ANY contest, view all participants, override freeze, finalize ratings.
- **`super_admin`**: Full platform authority across all contests, problems, submissions, and users.

Authorization is enforced at two layers:
1. Route layer: `authorizeRoles('professor', 'contest_admin', 'super_admin')`.
2. Controller / Service layer: `canManageResource(req.user, contest)` checking ownership and role hierarchy.

---

## Existing Contest Lifecycle

Contests follow a strict, dual-state lifecycle model combining a **persisted administrative status** and a **dynamic server-computed runtime state**:

```
                        PERSISTED STATUS (contests.status)
                  ┌───────────────────────────────────────────┐
                  │                  DRAFT                    │
                  └─────────────────────┬─────────────────────┘
                                        │
                                        │ POST /api/contests/:id/publish
                                        │ (requires >= 1 problem attached)
                                        ▼
                  ┌───────────────────────────────────────────┐
                  │                PUBLISHED                  │
                  └─────────────────────┬─────────────────────┘
                                        │
                                        │ PATCH /api/contests/:id { status: 'archived' }
                                        ▼
                  ┌───────────────────────────────────────────┐
                  │                ARCHIVED                   │
                  └───────────────────────────────────────────┘

                       DYNAMIC RUNTIME STATE (runtimeState)
              (Derived from start_time, end_time, and server clock)
              
                 now < start_time          ──► UPCOMING
                 start_time <= now < end_time ──► RUNNING (LOCKED)
                 now >= end_time           ──► ENDED   (LOCKED)
```

### Lifecycle Locking Matrix:
| Operation | Draft | Published (Upcoming) | Published (Running) | Published (Ended) | Archived |
|---|---|---|---|---|---|
| Edit Metadata (`title`, `desc`) | Allowed | Allowed | Allowed | Allowed | Blocked |
| Edit Dates (`startTime`, `endTime`)| Allowed | Allowed | **Blocked (409)** | **Blocked (409)** | **Blocked (409)** |
| Add / Remove Problems | Allowed | Allowed | **Blocked (409)** | **Blocked (409)** | **Blocked (409)** |
| Publish Contest | Allowed | N/A (Already pub) | N/A | N/A | N/A |
| Join Contest | Blocked | Allowed | Allowed | **Blocked (400)** | **Blocked (400)** |
| Submissions Allowed | Blocked | Blocked | Allowed | Allowed (practice) | Allowed (practice) |
| Delete Contest | Allowed* | Allowed* | **Blocked** | **Blocked** | **Blocked** |
| Finalize Ratings | Blocked | Blocked | Blocked | Allowed | Allowed |

*Note: Deletion of any contest is strictly blocked (HTTP 409) if any submissions exist for that contest.

---

## Contest-Problem Integration

- Attached via junction table `contest_problems(contest_id, problem_id, points, problem_order)`.
- Ordering: Handled by `problem_order` ASC.
- Point values: Configurable per contest problem mapping (defaults to 100).
- Problem access scope: In Phase 7.4, problems with `access_scope = 'contest_private'` are hidden from general problem discovery, but authorized for students enrolled in the corresponding contest.
- Integrity: Adding duplicate problems is prevented via composite primary key and returns `409 Conflict`.
- Problem locking: Once a contest becomes `running` or `ended`, attaching or detaching problems is permanently locked to preserve competitive fairness and scoring integrity.

---

## Participant Integration

- Managed via table `contest_participants(contest_id, user_id, joined_at)`.
- Students enroll via `POST /api/contests/:id/join`.
- Enrollment is restricted to published contests that have not yet ended.
- Duplicate joins are rejected with `409 Conflict`.
- Managers can inspect all enrolled participants via `GET /api/contests/:id/participants`.
- Current schema does not enforce a maximum participant cap (unlimited participation).

---

## Submission Integration

- When students submit code or run sample test cases during a contest, the request includes `contestId`.
- `submissionController.js` verifies:
  1. Contest exists and is `published`.
  2. Contest is in `running` state (or allowed window).
  3. Student is enrolled in `contest_participants`.
  4. Problem is attached in `contest_problems`.
- The submission record stores `contest_id` and joins with `contests` for filtering and reporting.
- Submissions are evaluated by the Judge and scored against contest problem point values.

---

## Leaderboard Integration

- Driven by `backend/src/services/standingsService.js`.
- Standings are computed dynamically from `submissions`, `contest_problems`, and `contest_participants`.
- Supports freeze window: if `leaderboard_freeze_enabled = true`, the scoreboard freezes `leaderboard_freeze_minutes` prior to `end_time`. Submissions during the freeze are masked for public viewers.
- Managers (`professor` owner, `contest_admin`, `super_admin`) can view live unmasked standings by passing `?freezeOverride=true`.

---

## Rating Integration

- Driven by `backend/src/services/ratingService.js`.
- Uses a multi-participant pairwise Elo algorithm calibrated for competitive programming.
- Triggered by `POST /api/contests/:id/finalize-ratings`.
- Prerequisites:
  - Contest must have `is_rated = true`.
  - Contest must have reached `runtimeState === 'ended'`.
  - Contest must not have already finalized ratings (`is_rating_finalized === false`).
- Finalization commits new ratings to `users`, records entries in `rating_history`, and updates `contests.is_rating_finalized = true`.

---

## Student Panel Integration

The student interface interacts with contests via:
- Discovery: `GET /api/contests?status=published` and `GET /api/contests?state=running` (displayed in `StudentDashboard.jsx`).
- Contest details & problems: `GET /api/contests/:id`.
- Registration: `POST /api/contests/:id/join`.
- Execution: Submissions sent with `contestId`.
- Leaderboard: `GET /api/contests/:id/leaderboard` rendered by `ContestLeaderboard.jsx`.

The Admin Panel will manage the exact same backend contest records consumed by students.

---

## Admin Panel Integration

### Current State:
In `frontend/src/components/AdminPanel.jsx`, the `contests` section renders `AdminContestManagement.jsx`.
Currently, `AdminContestManagement.jsx` (243 lines) is a rudimentary prototype:
- It fetches contests via `GET /api/contests`.
- It renders a simple HTML table with client-side text filtering.
- It offers basic Publish and Archive buttons.
- **It lacks**:
  - Contest creation modal/form.
  - Contest editing interface.
  - Contest problem manager (browse, add, remove, reorder, assign points).
  - Enrolled participants inspector.
  - Rating finalization action and status display.
  - Leaderboard shortcut.
  - Server-side pagination, sorting, and runtime state filtering.
  - Lifecycle lock feedback.

### Proposed Admin Contest Suite:
To match the standard established in Phase 7.4 Problem Management, Contest Management will be developed as a cohesive suite:
- `AdminContestManagement.jsx`: Master discovery table with status filters, runtime state tabs, search, pagination, and quick actions.
- `AdminContestEditorModal.jsx`: Modal for creating and editing contest metadata, timing, and configuration.
- `AdminContestProblemsModal.jsx`: Problem assignment workspace (search problems, configure points, order, bulk actions).
- `AdminContestParticipantsModal.jsx`: View enrolled participants, joined timestamps, and metrics.
- `AdminContestDetailsModal.jsx` / Quick Drawer: Comprehensive contest inspection view.

---

## Security Audit

1. **Authorization & Privilege Escalation**:
   - Strict RBAC: Only `professor`, `contest_admin`, and `super_admin` can create or manage contests. Students are strictly rejected with 403 Forbidden.
   - Resource Ownership: Professors can only modify or publish their own contests. Cross-professor tampering is blocked with 403 Forbidden.
2. **Draft & State Leakage Prevention**:
   - Draft contests are hidden from unprivileged `GET /api/contests` requests.
   - Direct requests to `GET /api/contests/:id` for draft contests reject non-managers with 403 Forbidden before leaking metadata.
   - Unauthorized mutation attempts reject with 403 before checking lifecycle locks, ensuring contest timing or state is not leaked to unauthorized actors.
3. **Data Integrity & Concurrency**:
   - `SELECT ... FOR UPDATE` row-level locks prevent race conditions during updates, problem mutations, publishing, and deletions.
   - Atomic transactions (`BEGIN` ... `COMMIT` / `ROLLBACK`) ensure all changes are committed cleanly.
4. **Deletion Safety**:
   - Deleting a contest that has historical submissions is strictly rejected with `409 Conflict`, preserving academic records and student performance history.
   - Defense-in-depth: PostgreSQL `ON DELETE RESTRICT` constraint on `submissions.contest_id`.
5. **Audit Logging**:
   - Every contest creation, update, publish, problem addition, problem removal, and deletion event generates a structured audit log entry in `audit_logs`.
   - Denied unauthorized actions trigger `PRIVILEGED_ACTION_DENIED` security audit events.

---

## Time / Scheduling Audit

- **Authoritative Server Clock**:
  All contest states (`upcoming`, `running`, `ended`) and lock evaluations are computed on the server using `new Date()` against PostgreSQL `timestamptz` values.
- **Client Independence**:
  Clients cannot spoof or force a contest into `running` or `ended` state. The backend independently validates timestamps upon every mutation and submission.
- **ISO 8601 Consistency**:
  Dates are stored and transmitted as UTC ISO 8601 strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- **Freeze Window Calculation**:
  Leaderboard freeze begins at `endTime - (leaderboardFreezeMinutes * 60000)` using UTC epoch milliseconds.

---

## Existing Tests

Existing contest functionality is backed by an automated test suite across multiple test harnesses:

1. **`backend/test_phase3.js`**:
   - 32 tests covering problem creation, contest creation, ownership isolation, problem attachment, publishing gates, runtime state calculation, contest joining, and deletion.
   - **Result**: 32 Passed, 0 Failed.
2. **`backend/test_phase5_9_2_4_contest_lifecycle_locks.js`**:
   - 26 tests verifying draft mutations, running contest mutation locks (409 Conflict), ended contest locks, archived contest locks, cross-professor authorization, concurrency (10 concurrent requests), and audit logging.
   - **Result**: 26 Passed, 0 Failed.
3. **`backend/test_phase5_9_2_5_contest_problem_locks.js`**:
   - 31 tests verifying problem addition/removal in draft contests, problem mutation locks during running contests, bulk operations locks, historical contest locks, RBAC, state leakage protection, and concurrency.
   - **Result**: 31 Passed, 0 Failed.
4. **`backend/test_phase5_9_2_2_deletion_safety.js`**:
   - 23 tests verifying deletion safety, submission preservation, and foreign key defense-in-depth for contests and problems.
   - **Result**: 23 Passed, 0 Failed.

**Total Verified Existing Tests**: Over 112 automated contest tests passing with 100% success rate.

---

## Findings

### Reusable Components
- **Database Schema**: `contests`, `contest_problems`, `contest_participants`, `submissions`, `rating_history` are completely built and indexed.
- **Backend APIs**: 16 REST endpoints on `/api/contests` covering the full CRUD, problem mapping, participant listing, lifecycle, and rating finalization.
- **Service Layer**: `contestService.js`, `standingsService.js`, `ratingService.js`, `auditLogger.js` are robust and production-grade.
- **Model Layer**: `contestModel.js` handles transactions, row locks, safety checks, and bulk operations.
- **Frontend Design Tokens**: Reusable styles, dark theme, navigation shell, notification system, and modal patterns from Phase 7.1–7.4.

### Missing Components (To Be Built in Phase 7.5)
- **Contest Creation Workflow**: Rich modal/form in Admin Panel for drafting new contests with date pickers, duration calculator, freeze settings, and rating options.
- **Contest Metadata Editor**: Modal for updating contest settings with clear lifecycle lock indicators (disabling timing edits for running/ended contests).
- **Contest Problem Management UI**: Interactive problem selector to search, attach, assign points, set problem order, reorder, and remove problems.
- **Contest Lifecycle Controls**: Dedicated actions for Publish (with readiness pre-check), Archive, and Delete with submission-aware confirmation modals.
- **Participant Inspector**: Drawer/modal to view enrolled students, join timestamps, and registration stats.
- **Rating Finalization Action**: Button/workflow to trigger and confirm Elo rating finalization on ended contests.
- **Contest Discovery & Filtering**: Search bar, status filters (`draft`, `published`, `archived`), runtime state tabs (`all`, `upcoming`, `running`, `ended`), sorting, and pagination.

### Potential Risks
- **Timezone Confusion**: Ensuring admin users configure start/end times in their local timezone while the client properly converts to UTC ISO 8601 strings.
- **Lifecycle Mutation Conflicts**: Admins attempting to edit dates or problems of running contests must receive clear UI warnings before triggering backend 409 Conflict errors.
- **Unintended Problem Detachment**: Removing problems after publishing must be safeguarded.

### Duplicate/Legacy Components
- Legacy `AdminContestManagement.jsx`: To be refactored and modernized in Phase 7.5.2 to support full discovery, search, filtering, and modal triggers.
- Duplicate problem validators in `contestValidation.js`: Historically left from Phase 3; can remain untouched for backward compatibility while problem management uses Phase 7.4 validators.

---

## Proposed Phase 7.5 Structure

Based on the audit findings and the established sub-phase pattern, the following 12-subphase roadmap is proposed for Phase 7.5:

- **Phase 7.5.1**: Contest Management Architecture & Audit *(Current)*
- **Phase 7.5.2**: Contest List & Discovery (Enhanced table, search, status/state filters, pagination, badges)
- **Phase 7.5.3**: Create Contest Workflow (Modal/form, timing, duration, freeze config, isRated flag)
- **Phase 7.5.4**: Edit Contest & Configuration (Edit modal, lifecycle lock awareness, form validation)
- **Phase 7.5.5**: Contest Problem Management (Browse problems, attach, points, ordering, detach, bulk operations)
- **Phase 7.5.6**: Contest Lifecycle Management (Publish verification gate, archive, safe delete, runtime status indicators)
- **Phase 7.5.7**: Participant & Enrollment Management (Participant drawer/modal, enrollment table, counts)
- **Phase 7.5.8**: Leaderboard & Results Integration (Direct leaderboard link, freeze override mode, standings preview)
- **Phase 7.5.9**: Rating Finalization & History (Finalize ratings action, confirmation modal, rating history view)
- **Phase 7.5.10**: Security & Validation Hardening (IDOR checks, RBAC verification, audit logging, input sanitization)
- **Phase 7.5.11**: Testing & Regression (End-to-end admin contest tests, concurrency verification, regression suite)
- **Phase 7.5.12**: Integration & Phase Completion (Admin Panel integration verification, student panel compatibility, final audit)

---

## Dependencies
- **Phase 7.4 Problem Management**: Provides the problem catalog attached to contests (`problems` table, `access_scope = 'contest_private'`).
- **PostgreSQL Database**: Existing schema and connection pool.
- **Judge & Submission Engine**: Processes contest submissions with `contestId`.
- **Standings & Rating Services**: Handles leaderboard computation and Elo finalization.
- **Admin Panel Shell**: Reuses navigation, notification system, and theme tokens.

---

## Implementation Plan
1. **Frontend Architecture**:
   - Refactor `AdminContestManagement.jsx` into a modular suite with clean separation of concerns.
   - Build lightweight, accessible modal components for Create, Edit, Problems, and Participants.
   - Wire all API interactions to the existing `/api/contests` endpoints using standard fetch with auth headers.
2. **Backend Enhancements**:
   - Only make minimal adjustments if required during subsequent sub-phases (e.g., adding freeze duration bounds validation in 7.5.10).
   - Zero changes to core database schema or existing table relationships.
3. **Strict Validation & Error Handling**:
   - Handle 409 Conflict gracefully in the UI with human-readable explanations of lifecycle locks.
   - Prevent submissions-exist deletion errors by disabling delete action when participant or submission counts > 0.

---

## Known Issues
- Currently, `AdminContestManagement.jsx` performs in-memory filtering and lacks pagination, which does not scale for large contest catalogs. (To be resolved in Phase 7.5.2).
- Contest creation and editing can currently only be tested via backend scripts because no UI modal exists in the Admin Panel. (To be built in Phase 7.5.3 & 7.5.4).

---

## Final Status
- **Audit**: Comprehensive & Complete.
- **Architecture**: Established with Maximum Reuse & Zero Unnecessary Duplication.
- **Database Status**: Validated — No new tables needed.
- **Backend APIs**: 16 routes validated and operational.
- **Automated Tests**: 112+ existing tests passing.
- **Sub-Phase 7.5.1**: **COMPLETE**.
