# Phase 7.5.7.1 Report

## Phase
7.5.7.1 Participant Management Architecture & Audit

## Goal
Conduct a thorough, evidence-based architectural, database, security, and integration audit of all existing participant, enrollment, and registration mechanisms across the platform without implementing new features ahead of schedule. Determine existing capabilities, data structures, access control rules, lifecycle integrations, submission dependencies, and performance characteristics to inform Sub-phases 7.5.7.2 through 7.5.7.7.

---

## Existing Participant Architecture

The platform possesses a foundational participant model established in Phase 3 and reinforced across subsequent phases (Submissions, Problem Authoring, Standings, and Lifecycle). The architecture spans the following tiers:

### Backend Architecture
- **Routing Layer (`backend/src/routes/contestRoutes.js`)**:
  - `POST /api/contests/:id/join`: Publicly accessible to any authenticated user subject to rate limiting (`contestActionRateLimiter`).
  - `GET /api/contests/:id/participants`: Restricted to contest managers (`professor`, `contest_admin`, `super_admin`) subject to rate limiting (`mediumProtectionRateLimiter`).
- **Controller Layer (`backend/src/controllers/contestController.js`)**:
  - `joinContest`: Handles student/user enrollment, verifies contest existence, validates `published` lifecycle state, verifies `runtimeState !== 'ended'`, checks for duplicate enrollment, and invokes `ContestModel.addParticipant`.
  - `getContestParticipants`: Retrieves enrolled participants for a contest with BOLA protection via `canManageResource(req.user, contest)`.
- **Model Layer (`backend/src/models/contestModel.js`)**:
  - `ContestModel.addParticipant(contestId, userId)`: Executes raw `INSERT INTO contest_participants (contest_id, user_id)`.
  - `ContestModel.findParticipant(contestId, userId)`: Queries participant record by composite key.
  - `ContestModel.getContestParticipants(contestId)`: Retrieves all participants joined with `users` (`userId`, `username`, `fullName`, `joinedAt`).
- **Cross-Service Integrations**:
  - `submissionController.js` (`submitSolution`, `runSampleTests`): Strictly enforces that students must have an existing record in `contest_participants` before submitting solutions or executing sample tests against contest problems.
  - `problemModel.js` (`hasAccess`): Grants access to `contest_private` problems if the user is an enrolled participant in a published contest containing that problem.
  - `standingsService.js`: Builds contest scoreboards by querying `contest_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.contest_id = $1 AND u.role = 'student'`.
  - `ratingService.js`: Finalizes competitive Elo ratings based on standings derived from `contest_participants`.
  - `userModel.js`: Derives `contestsJoinedCount` via `(SELECT COUNT(*)::int FROM contest_participants WHERE user_id = u.id)`.
  - `adminController.js`: Computes `COUNT(DISTINCT part.user_id) AS "participantCount"` for admin contest listings.

### Frontend Architecture
- **Master Contest Management (`frontend/src/components/admin/AdminContestManagement.jsx`)**:
  - Displays authoritative `c.participantCount` in the contest table and aggregated metric summary.
  - Inspection Drawer (`inspect-body`) displays contest metadata and `<AdminContestProblemList />`, but lacks a dedicated participant management tab or list.
- **Admin Dashboard (`frontend/src/components/admin/AdminDashboard.jsx`)**:
  - Renders participant counts in overview cards.
- **Client Application Shell (`frontend/src/App.jsx`)**:
  - Features helper `ensureContestJoined(contestId, authToken)` which triggers `POST /api/contests/:id/join` upon contest entry or action.
- **Contest Leaderboard (`frontend/src/components/ContestLeaderboard.jsx`)**:
  - Displays total enrolled participants count (`contestSummary.totalParticipants`), participant ranks, usernames, and scores.

---

## Existing Participant Routes

| HTTP Method | Route | Authorization / Middleware | Controller Method | Status |
|---|---|---|---|---|
| `POST` | `/api/contests/:id/join` | `authenticate`, `contestActionRateLimiter` | `contestController.joinContest` | **Existing & Working** |
| `GET` | `/api/contests/:id/participants` | `authenticate`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, `mediumProtectionRateLimiter` | `contestController.getContestParticipants` | **Existing & Working** |
| `GET` | `/api/contests/:id/participants/me` | None (Route does not exist) | None | **Missing** |
| `POST` | `/api/contests/:id/participants` | None (Admin manual enrollment route does not exist) | None | **Missing** |
| `DELETE` | `/api/contests/:id/participants/:userId` | None (Participant removal route does not exist) | None | **Missing** |
| `POST` | `/api/contests/:id/participants/bulk` | None (Bulk enrollment route does not exist) | None | **Missing** |

---

## Existing Participant Services

Currently, participant operations are embedded inside `ContestModel` and `ContestController`. There is no isolated `participantService.js` or `participantModel.js`.

### Implemented Methods
1. **`ContestModel.addParticipant(contestId, userId)`**:
   - Location: `backend/src/models/contestModel.js#L1375-1383`
   - Logic: Inserts `(contest_id, user_id)` and returns `{ contestId, userId, joinedAt }`.
2. **`ContestModel.findParticipant(contestId, userId)`**:
   - Location: `backend/src/models/contestModel.js#L1385-1393`
   - Logic: Queries single record matching `(contest_id, user_id)`.
3. **`ContestModel.getContestParticipants(contestId)`**:
   - Location: `backend/src/models/contestModel.js#L1395-1409`
   - Logic: Queries all participants joined with `users`, returning `userId`, `username`, `fullName`, and `joinedAt` ordered chronologically by `joined_at ASC`.
4. **`StandingsService.getContestStandings({ contestId, showUnfrozen, clientOrDb })`**:
   - Location: `backend/src/services/standingsService.js#L85-103`
   - Logic: Queries all student participants from `contest_participants` and maps their submissions into the scoreboard.
5. **`RatingService.finalizeContestRatings(contestId, operatorUser, options, req)`**:
   - Location: `backend/src/services/ratingService.js#L125-240`
   - Logic: Evaluates participants from standings to calculate rating updates and persists them into `rating_history`.

---

## Existing Database Model

The database represents participants via a dedicated associative table `contest_participants`.

```
                    ┌───────────────────────────┐
                    │          contests         │
                    ├───────────────────────────┤
                    │ id (PK)                   │
                    │ title                     │
                    │ status                    │
                    │ created_by (FK -> users)  │
                    │ ...                       │
                    └─────────────┬─────────────┘
                                  │ 1
                                  │
                                  │ ON DELETE CASCADE
                                  ▼ *
                    ┌───────────────────────────┐
                    │    contest_participants   │
                    ├───────────────────────────┤
                    │ contest_id (PK, FK)       │
                    │ user_id    (PK, FK)       │
                    │ joined_at  (TIMESTAMPTZ)  │
                    └─────────────▲─────────────┘
                                  │ *
                                  │ ON DELETE CASCADE
                                  │
                                  │ 1
                    ┌─────────────┴─────────────┐
                    │           users           │
                    ├───────────────────────────┤
                    │ id (PK)                   │
                    │ username                  │
                    │ email                     │
                    │ role                      │
                    │ is_active                 │
                    │ ...                       │
                    └───────────────────────────┘
```

### Participant Identity
- The participant is uniquely identified by the composite tuple `(contest_id, user_id)`.
- There is no surrogate synthetic primary key (no `id SERIAL`); the composite primary key enforces both identity and duplicate prevention.

---

## Contest Participants Schema

Direct inspection of PostgreSQL catalog (`pg_constraint`, `information_schema.columns`, `pg_indexes`) yields:

### Columns
| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `contest_id` | `integer` | `NO` | `NULL` | Foreign key referencing `contests(id)` |
| `user_id` | `integer` | `NO` | `NULL` | Foreign key referencing `users(id)` |
| `joined_at` | `timestamp with time zone` | `YES` | `CURRENT_TIMESTAMP` | Timestamp when user joined contest |

### Constraints
- **Primary Key**: `contest_participants_pkey PRIMARY KEY (contest_id, user_id)`.
- **Foreign Key 1**: `contest_participants_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE`.
- **Foreign Key 2**: `contest_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

### Indexes
1. `contest_participants_pkey`: `CREATE UNIQUE INDEX contest_participants_pkey ON public.contest_participants USING btree (contest_id, user_id)` (Automatic from PK).
2. `idx_contest_participants_contest`: `CREATE INDEX idx_contest_participants_contest ON public.contest_participants USING btree (contest_id)`.
3. `idx_contest_participants_user`: `CREATE INDEX idx_contest_participants_user ON public.contest_participants USING btree (user_id)`.

### Cascade & Integrity Behavior
- **Contest Deletion**: If a contest without submissions is deleted, `ON DELETE CASCADE` automatically purges associated `contest_participants` rows. (If submissions exist, `submissions.contest_id RESTRICT` blocks deletion).
- **User Deletion**: If a user is deleted from the platform, `ON DELETE CASCADE` automatically removes their `contest_participants` entries.
- **Duplicate Prevention**: The database strictly prevents duplicate enrollment via `PRIMARY KEY (contest_id, user_id)`. A second insert with identical `(contest_id, user_id)` triggers PostgreSQL error `23505 (unique_violation)`.

---

## Existing Enrollment Flow

The current enrollment flow proceeds as follows:

```
[Student in UI]
       │
       ▼ (triggers navigation / problem click)
[App.jsx: ensureContestJoined]
       │
       ▼ POST /api/contests/:id/join  (Authorization: Bearer <token>)
[RateLimiter: contestActionRateLimiter]
       │
       ▼
[AuthMiddleware: authenticate]
       │ verifies JWT, loads user, checks user.is_active === true
       ▼
[ContestController: joinContest]
       ├─► 1. ContestModel.findContestById(contestId)
       │      └─► Not found? Return 404
       ├─► 2. Check contest.status === 'published'
       │      └─► In draft/archived? Return 400 Bad Request
       ├─► 3. getContestRuntimeState(contest) === 'ended'
       │      └─► Ended? Return 400 Bad Request
       ├─► 4. ContestModel.findParticipant(contestId, userId)
       │      └─► Already joined? Return 409 Conflict
       └─► 5. ContestModel.addParticipant(contestId, userId)
              └─► INSERT INTO contest_participants -> 201 Created
```

### Flow Audit Findings
1. **Who can enroll**: Any authenticated user can call `/join`. Currently, non-student roles (`professor`, `contest_admin`) can technically join, but `standingsService` filters `WHERE u.role = 'student'` when rendering leaderboards.
2. **When enrollment is allowed**: Only when `contest.status === 'published'` AND `runtimeState !== 'ended'`.
3. **Contest lifecycle check**: Fully enforced; draft, unpublished, and ended contests reject join requests.
4. **Visibility / Access Scope**: Publicly accessible; no passcode, invite, or restricted course section checks exist yet.
5. **Duplicate enrollment**: Handled via preliminary `findParticipant` query (returns 409 Conflict).
6. **Inactive users**: Blocked at JWT authentication middleware (`authMiddleware.js#L78-88`), which rejects inactive users with 401 Unauthorized.
7. **Unpublished / Private contests**: Protected; draft contests reject join requests with 400 Bad Request.
8. **Manual Enrollment**: Missing; professors cannot currently add students manually via API.
9. **Idempotency**: Partially idempotent; repeat calls return 409 Conflict rather than 200/201 with existing record.

---

## Authorization Model

Access permissions for participant data and operations:

| Role | Self Enrollment | View Own Participation | View Contest Participants | Manage / Remove Participants | Cross-Contest Isolation |
|---|---|---|---|---|---|
| **Student** | Yes (Published & Active) | Inferred via access | **No (403 Forbidden)** | **No (403 Forbidden)** | Cannot view other participants' source code or unmask hidden tests |
| **Professor** | Allowed by API | N/A | **Yes (Own Contests Only)** | Not yet implemented | **Enforced**: Cannot view/manage participants of other professors' contests (403 BOLA) |
| **Contest Admin** | Allowed by API | N/A | **Yes (Platform-Wide)** | Allowed by role | Can inspect participants across all contests |
| **Super Admin** | Allowed by API | N/A | **Yes (Platform-Wide)** | Allowed by role | Unrestricted administrative access |

### BOLA Protection
- `getContestParticipants` invokes `canManageResource(req.user, contest)` (`backend/src/services/contestService.js#L76`).
- For professors, `creatorId === user.id` must evaluate to `true`. Cross-professor inspection attempts receive 403 Forbidden.

---

## Contest Access Scope

### Current Schema Findings
- The `contests` table contains: `id`, `title`, `description`, `created_by`, `start_time`, `end_time`, `status`, `is_rated`, `is_rating_finalized`, `ratings_finalized_at`, `leaderboard_freeze_enabled`, `leaderboard_freeze_minutes`, `created_at`, `updated_at`.
- There is **no `access_scope` or `visibility` column** on the `contests` table in the database schema.
- In `AdminContestCreateModal.jsx`, an `accessScope` radio group (`public` vs `private`) exists in the UI draft form, but the value is not persisted to PostgreSQL.
- Access isolation currently relies on `contests.status` (`draft` vs `published` vs `archived`) and `contests.created_by`.

---

## Lifecycle Integration

Lifecycle states established in Phase 7.5.6 interact with participant enrollment as follows:

| Contest Lifecycle State | Enrollment Permitted? | Existing Backend Check | Gaps Identified |
|---|---|---|---|
| **`draft`** | **No** | Enforced: `contest.status !== 'published'` returns 400 Bad Request | None; correctly locked |
| **`upcoming`** | **Yes** | Permitted: `contest.status === 'published'` and `runtimeState !== 'ended'` | None; allows advance pre-registration |
| **`running`** | **Yes** | Permitted: `runtimeState === 'running'` allows real-time join | None; allows live entry |
| **`ended`** | **No** | Enforced: `runtimeState === 'ended'` returns 400 Bad Request | None; rejects post-contest enrollment |
| **`archived`** | **No** | Enforced: `contest.status === 'archived'` returns 400 Bad Request | None; immutable historical record |

### Enforcement Location
- Lifecycle state is computed deterministically via `getContestRuntimeState(contest)` in `backend/src/services/contestService.js`.
- Enrollment checks reuse this single source of truth; no duplicate lifecycle engine exists.

---

## Submission Integration

### Submission vs Participant Verification
In `backend/src/controllers/submissionController.js`:
- Official Submissions (`submitSolution`, lines 51-60):
  ```javascript
  if (req.user.role === 'student') {
    const participant = await ContestModel.findParticipant(contestId, userId);
    if (!participant) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You must join the contest before you can submit code',
      });
    }
  }
  ```
- Interactive Sample Runs (`runSampleTests`, lines 170-179):
  - Applies identical verification; unenrolled students receive 403 Forbidden.
- Non-Student Roles:
  - Professors and Admins are permitted to submit without enrollment to facilitate problem verification and testing.

### Relational Integrity
- `submissions.contest_id` references `contests(id)` with `ON DELETE RESTRICT`.
- `submissions.user_id` references `users(id)` with `ON DELETE CASCADE`.
- There is **no direct foreign key** between `submissions` and `contest_participants`. If a participant were removed from `contest_participants`, their historical submissions would remain in `submissions` unless explicitly cleaned up or quarantined.

---

## Leaderboard Integration

### Identification in Standings
- `standingsService.js` (`backend/src/services/standingsService.js#L86-103`):
  ```sql
  SELECT 
    u.id AS "userId",
    u.username,
    u.full_name AS "fullName",
    u.avatar_url AS "avatarUrl",
    u.current_rating AS "currentRating",
    u.highest_rating AS "highestRating",
    u.rating_status AS "ratingStatus",
    u.rated_contest_count AS "ratedContestCount",
    cp.joined_at AS "joinedAt"
  FROM contest_participants cp
  JOIN users u ON cp.user_id = u.id
  WHERE cp.contest_id = $1 AND u.role = 'student'
  ORDER BY cp.joined_at ASC;
  ```
- All registered students in `contest_participants` appear on the scoreboard, even if they have submitted 0 solutions (score: 0, penalty: 0).
- If a user is not in `contest_participants`, they are completely excluded from the leaderboard calculation.

---

## Rating Integration

### Rating Dependency on Participants
- In `backend/src/services/ratingService.js`:
  - `finalizeContestRatings` invokes `StandingsService.getContestStandings({ contestId, showUnfrozen: true, clientOrDb })`.
  - The standings list (composed strictly of `contest_participants` where `u.role = 'student'`) is passed into `RatingService.calculateRatingChanges(standings)`.
  - Every participant in standings is processed in the multi-participant Elo calculation.
  - Updates are committed in an ACID transaction to `users` and `rating_history` (with unique constraint `uq_rating_history_user_contest UNIQUE (user_id, contest_id)`).

---

## Security Audit

1. **Authentication**: All participant endpoints require valid, non-expired JWT tokens via `authenticate`.
2. **Account Status**: `authMiddleware` verifies `user.is_active === true`; deactivated users cannot call participant endpoints.
3. **Role-Based Access Control (RBAC)**: `authorizeRoles('professor', 'contest_admin', 'super_admin')` guards participant listing.
4. **Broken Object Level Authorization (BOLA/IDOR)**: `canManageResource(req.user, contest)` guarantees that professors cannot view participant rosters of contests they do not own.
5. **SQL Injection**: All participant queries in `ContestModel` and `StandingsService` use parameterized queries (`$1, $2`).
6. **Mass Assignment**: `addParticipant` only accepts parameters extracted from trusted JWT (`req.user.id`) and validated route parameters (`req.params.id`).
7. **Rate Limiting**: `POST /join` is protected by `contestActionRateLimiter` (10 requests/minute per IP/user); `GET /participants` is protected by `mediumProtectionRateLimiter` (60 requests/minute).
8. **Audit Logging**: `joinContest` currently does NOT emit an audit log entry. Only administrative lifecycle and problem mutations emit audit logs.

---

## BOLA / IDOR Findings

- **Finding B-1 (Verified Secure)**: Professor B cannot inspect participants of Professor A's contest via `GET /api/contests/:id/participants`. `canManageResource` returns `false`, yielding HTTP 403 Forbidden.
- **Finding B-2 (Verified Secure)**: Student cannot inspect participant rosters via `GET /api/contests/:id/participants` (rejected with HTTP 403 by role middleware).
- **Finding B-3 (Gap for 7.5.7.4)**: When manual participant removal (`DELETE /participants/:userId`) or manual enrollment is introduced, ownership checks must ensure Professor B cannot remove participants from Professor A's contest.

---

## Concurrency Findings

### Concurrent Duplicate Enrollment Race Condition
- **Scenario**: A student fires two identical `POST /api/contests/:id/join` requests simultaneously (e.g. double-click in UI or network retry).
- **Current Execution**:
  1. Request 1 executes `findParticipant` -> returns `null`.
  2. Request 2 executes `findParticipant` -> returns `null`.
  3. Request 1 executes `INSERT INTO contest_participants` -> succeeds (201 Created).
  4. Request 2 executes `INSERT INTO contest_participants` -> hits DB `contest_participants_pkey` violation (Postgres error `23505`).
  5. In `contestController.js`, error `23505` is caught by generic `catch (error) { next(error); }`, which manifests as an uncaught 500 error rather than a graceful 409 Conflict.
- **Data Integrity**: **Preserved**. The database composite primary key `(contest_id, user_id)` guarantees duplicate rows can never be inserted.
- **Recommendation for 7.5.7.3**: Catch error code `23505` or use `INSERT INTO contest_participants ... ON CONFLICT DO NOTHING RETURNING ...` to gracefully return 409 Conflict or idempotent 200/201.

---

## Performance / Index Findings

### Target Scale
The target scale for V1 is **200–300 simultaneous students per contest**.

### Index Evaluation
1. `contest_participants_pkey` (`btree(contest_id, user_id)`): Provides $O(\log N)$ point lookups for individual participation status checks during submissions.
2. `idx_contest_participants_contest` (`btree(contest_id)`): Supports fast $O(\log N + K)$ scans when retrieving all participants for a contest or building the leaderboard.
3. `idx_contest_participants_user` (`btree(user_id)`): Supports fast lookups when fetching user profile contest counts.

### Performance Gaps
1. **Unpaginated Roster Endpoint**: `GET /api/contests/:id/participants` currently performs an unpaginated query returning all rows. For 200–300 users, response payloads (~30 KB) are manageable, but pagination (`page`, `limit`), sorting, and search filtering will be essential for administrative ergonomics in 7.5.7.2.
2. **Leaderboard Calculation**: `standingsService` loads all student participants and evaluates full submission matrices. With proper indexes on `submissions(contest_id, created_at)`, computing standings for 300 students completes in < 50ms.

---

## Frontend Architecture

### Existing State
- `AdminContestManagement.jsx` contains the administrative contest table, search bar, status filters, and inspection drawer.
- The inspection drawer (`inspect-body`) displays contest lifecycle details, timing, rules, and problem attachments (`<AdminContestProblemList />`), but does not have a participant view.
- In student views (`App.jsx`), auto-joining occurs transparently via `ensureContestJoined`.

### Recommended Integration Point for Phase 7.5.7
1. **Admin Panel**:
   - In `AdminContestManagement.jsx` -> Contest Inspection Drawer: Introduce a tabbed view or dedicated section `<AdminContestParticipantList contestId={...} />` mirroring the architecture of `<AdminContestProblemList />`.
   - Provide participant table with columns: Username, Full Name, Rating, Joined At, Status, and Actions (Remove/Disqualify).
   - Provide manual enrollment button opening an enrollment modal.
2. **Student Flow**:
   - Provide explicit "Register for Contest" / "Joined" status indicators on contest cards and contest detail headers.

---

## Existing Tests

### Inventory of Tests Covering Participant Logic
| Test File | Test Cases Relevant to Participants | Status |
|---|---|---|
| `backend/test_phase3.js` | 5.1 Student joins published contest (201)<br>5.2 Duplicate join returns 409<br>5.3 Joining ended contest returns 400<br>5.4 Student cannot view participants (403)<br>5.5 Professor views participants (200)<br>5.6 Participant count verification | **Passing (32/32)** |
| `backend/test_step3_security_audit.js` | Section 4: Student joins contest before submission<br>Section 7.1: Duplicate join returns 409 Conflict | **Passing (7.1)** |
| `backend/test_phase5_9_2_2_deletion_safety.js` | TEST 13: Contest participant registration record remains intact in DB during protected contest deletion | **Passing (23/23)** |
| `backend/test_phase5_9_2_4_contest_lifecycle_locks.js` | Lifecycle state transitions affecting contest access | **Passing (26/26)** |
| `backend/test_admin_phase5_6_contest_lifecycle.js` | Full lifecycle verification across draft, upcoming, running, ended, archived | **Passing (75/75)** |
| `frontend/test_admin_phase5_6_contest_lifecycle_ui.js` | Lifecycle UI display and action dispatching | **Passing (35/35)** |

### Missing Test Coverage
- No tests for concurrent double-join database collision handling.
- No tests for participant removal or manual admin enrollment (features do not exist yet).
- No frontend component unit tests for participant lists.

---

## Missing Capabilities

The audit identifies the following capabilities as missing for subsequent sub-phases:

1. **Sub-Phase 7.5.7.2 (Participant List)**:
   - Paginated, searchable, sortable backend participant list endpoint (`GET /api/contests/:id/participants?page=1&limit=20&search=...`).
   - Administrative UI participant table in Contest Inspection drawer.
2. **Sub-Phase 7.5.7.3 (Enrollment)**:
   - Explicit student enrollment API and UI registration buttons.
   - Idempotent enrollment and graceful handling of concurrent join races (catching DB 23505).
   - Audit logging for contest registration.
3. **Sub-Phase 7.5.7.4 (Manual Participant Management)**:
   - Admin/Professor endpoint to manually add participant (`POST /api/contests/:id/participants`).
   - Admin/Professor endpoint to remove participant (`DELETE /api/contests/:id/participants/:userId`).
4. **Sub-Phase 7.5.7.5 (Bulk Operations)**:
   - Bulk enrollment endpoint (`POST /api/contests/:id/participants/bulk`) accepting user IDs/usernames/emails.
5. **Sub-Phase 7.5.7.6 (Eligibility & Access Restrictions)**:
   - Rating cap/floor eligibility rules (e.g. Div. 2: rating < 1600).
   - Private contest enrollment restrictions (passcodes or invited participant whitelists).
6. **Sub-Phase 7.5.7.7 (Participant Status & Disqualification)**:
   - Schema extension for participant status (`registered`, `active`, `disqualified`).
   - Disqualification flag preventing submission and excluding from rating calculations.

---

## Recommended 7.5.7 Implementation Sequence

1. **7.5.7.2 Participant List**: Implement server-side paginated, searchable participant query in `contestModel`/service and build `<AdminContestParticipantList />` component for the admin inspection drawer.
2. **7.5.7.3 Enrollment Hardening**: Harden `joinContest` with transaction safety, `ON CONFLICT DO NOTHING`, audit logging, and student UI registration controls.
3. **7.5.7.4 Manual Participant Management**: Implement single-student manual addition and removal endpoints with strict BOLA checks and confirmation dialogs.
4. **7.5.7.5 Bulk Operations**: Implement transactional bulk enrollment with partial success reporting and audit logging.
5. **7.5.7.6 Eligibility**: Implement rating-based and invite-based eligibility enforcement on enrollment endpoints.
6. **7.5.7.7 Participant Status**: Add participant status tracking (`registered`, `disqualified`) with integration into standings and rating finalization.

---

## Files That Will Likely Be Modified Later

### Backend Files
- `backend/src/routes/contestRoutes.js`: Add participant management routes.
- `backend/src/controllers/contestController.js` (or new `participantController.js`): Add list pagination, manual add, remove, and bulk operations.
- `backend/src/models/contestModel.js` (or new `participantModel.js`): Add paginated search and delete queries.
- `backend/src/services/contestService.js`: Participant management authorization helpers.
- `backend/src/services/auditLogger.js`: Event types for `PARTICIPANT_JOINED`, `PARTICIPANT_REMOVED`, `PARTICIPANT_ADDED_BY_ADMIN`.

### Frontend Files
- `frontend/src/components/admin/AdminContestManagement.jsx`: Integrate participant inspection sub-component.
- `frontend/src/components/admin/AdminContestParticipantList.jsx` (New component): Dedicated participant table with pagination, search, and action buttons.
- `frontend/src/components/admin/adminContestManagement.css`: Styles for participant table, badges, and modals.
- `frontend/src/components/StudentDashboard.jsx` / `App.jsx`: Explicit contest registration buttons and status indicators.

---

## Critical Issues Requiring Immediate Fix

**None**.
- The existing participant schema and routes are functional and stable.
- The composite primary key `(contest_id, user_id)` guarantees database-level duplicate prevention.
- BOLA protection (`canManageResource`) and RBAC middleware prevent unauthorized access.
- In accordance with the strict scope of Phase 7.5.7.1, no emergency code modification is required.

---

## Known Limitations

1. **Lack of Participant Pagination**: `GET /api/contests/:id/participants` returns all participants in a single JSON payload.
2. **No Audit Logging on Self-Enrollment**: `joinContest` does not log an event in `audit_logs`.
3. **Race Condition Returns 500 Instead of 409**: Simultaneous duplicate enrollments trigger a database primary key violation that falls through to the generic 500 error handler rather than returning a clean 409 Conflict.
4. **No Participant Status Field**: Participants cannot currently be marked as disqualified or withdrawn without deleting the row entirely.
5. **No Direct Submission FK**: `submissions` references `contest_id` and `user_id` independently rather than a composite FK to `contest_participants`.

---

## Final Status

**COMPLETE (Audit Only)**
- Architecture and implementation audit completed across backend, database, and frontend.
- All 13 participant data model questions answered with empirical code and schema evidence.
- No feature code modified or premature migrations introduced.
- Existing regression test suites passing (Phase 3: 32/32 passed, Deletion Safety: 23/23 passed, Lifecycle Locks: 26/26 passed, Lifecycle Admin: 75/75 passed, Frontend UI: 35/35 passed).
- System builds cleanly (`vite build` in 1.09s) and passes health check (`/api/health` 200 OK).
- Ready for sub-phase 7.5.7.2.
