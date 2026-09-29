# Phase 7.5.7.4 Report — Manual Participant Management

## 1. Phase & Scope

### Phase Definition
- **System**: ExamForge Contest Platform
- **Phase**: Phase 7.5 — Contest Management
- **Sub-Phase**: 7.5.7.4 — Manual Participant Management
- **Status**: Completed Successfully

### Strict Scope Boundaries
- **In Scope (Implemented & Verified)**:
  - Backend authoritative endpoints for single participant manual addition (`POST /api/contests/:id/participants`).
  - Backend authoritative endpoints for single participant manual removal (`DELETE /api/contests/:id/participants/:userId`).
  - Candidate student search endpoint (`GET /api/contests/:id/search-students?search=...&limit=...`) strictly scoped to active students not yet enrolled in the specified contest.
  - Strict RBAC: only Super Admin, Contest Admin, and owning Professor (`canManageResource`) can search candidates, add participants, or remove participants. Non-owning professors blocked with 403 Forbidden (BOLA defense). Students blocked with 403 Forbidden.
  - Target user validation: target user must exist, be active (`is_active = true`), and possess the `'student'` role.
  - Lifecycle restrictions: participants cannot be added to or removed from `ended` or `archived` contests (HTTP 409 Conflict).
  - Historical data preservation: participants who have recorded submissions in the contest cannot be removed (HTTP 409 Conflict).
  - Concurrency safety: atomic database unique constraints catch race conditions on simultaneous additions and return HTTP 409 without 500 crashes or data duplication.
  - Security audit logging: persistent recording of `PARTICIPANT_ADDED`, `PARTICIPANT_REMOVED`, and `PRIVILEGED_ACTION_DENIED`.
  - Frontend Admin Participant Management UI: "Add Participant" button, candidate student search modal with debounced search, student selection, loading states, and error alerts; per-row "Remove" button with confirmation modal, submission integrity warning, and conflict error handling; lifecycle lock banners and disabled controls.
- **Strictly Excluded (Deferred to Future Sub-Phases)**:
  - 7.5.7.5: Bulk Participant Operations (CSV/batch enrollment, bulk unenrollment).
  - 7.5.7.6: Advanced Eligibility & Access Validation (branch/semester restrictions, rating floors).
  - 7.5.7.7: Participant Status Management (disqualification, suspension, unrated tags).
  - 7.5.8+: Leaderboard, rating recalculations, or Phase 7.6.

---

## 2. Audit Findings Before Changes

1. **Database Schema**:
   - `contest_participants` table schema: `(contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, joined_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (contest_id, user_id))`.
   - `submissions` table schema: contains `contest_id INTEGER REFERENCES contests(id) ON DELETE RESTRICT` and `user_id INTEGER REFERENCES users(id)`.
2. **Existing Methods in Model**:
   - `ContestModel.addParticipant(contestId, userId)` existed from Phase 7.5.7.3.
   - Missing: `ContestModel.removeParticipant(contestId, userId)`.
   - Missing: `ContestModel.searchAvailableStudents(contestId, { search, limit })`.
3. **Data Integrity Rule**:
   - Removing a participant who has submitted code to the contest would invalidate submission ownership or leave orphan submissions. An authoritative check (`SELECT 1 FROM submissions WHERE contest_id = $1 AND user_id = $2 LIMIT 1`) was required before allowing deletion.

---

## 3. Architecture & Data Flow

```
[Admin / Professor Browser]
       │
       ├─ (1) Search candidates ──► GET /api/contests/:id/search-students?search=...
       │                                 │
       │                                 ▼
       │                           [ContestModel.searchAvailableStudents]
       │                           (Filters active students not enrolled)
       │
       ├─ (2) Add participant ────► POST /api/contests/:id/participants { userId }
       │                                 │
       │                                 ▼
       │                           [canManageResource check (RBAC/BOLA)]
       │                           [Lifecycle: draft/running vs ended/archived]
       │                           [Target user: student role, active]
       │                           [Duplicate / Race check: 409 Conflict]
       │                           [INSERT INTO contest_participants]
       │                           [Audit Log: PARTICIPANT_ADDED]
       │
       └─ (3) Remove participant ─► DELETE /api/contests/:id/participants/:userId
                                         │
                                         ▼
                                   [canManageResource check (RBAC/BOLA)]
                                   [Lifecycle: draft/running vs ended/archived]
                                   [Participant existence check: 404]
                                   [Submission check: 409 if submissions exist]
                                   [DELETE FROM contest_participants]
                                   [Audit Log: PARTICIPANT_REMOVED]
```

---

## 4. Backend Changes

### 1. `backend/src/models/contestModel.js`
- **`ContestModel.removeParticipant(contestId, userId)`**:
  - Executes `DELETE FROM contest_participants WHERE contest_id = $1 AND user_id = $2 RETURNING *`.
  - Returns `boolean` (`rowCount > 0`).
- **`ContestModel.searchAvailableStudents(contestId, { search, limit })`**:
  - Queries `users u` where `u.role = 'student' AND u.is_active = true`.
  - Excludes already enrolled students: `AND NOT EXISTS (SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = u.id)`.
  - Applies ILIKE search filter across `u.username`, `u.full_name`, and `u.email`.
  - Orders by `u.username ASC` with clamped limit (default 10, max 50).
  - Shields sensitive user credentials (never selects `password_hash`).

### 2. `backend/src/controllers/contestController.js`
- **`searchContestCandidateStudents`**:
  - Validates positive integer contest ID.
  - Verifies `canManageResource(req.user, contest)`.
  - Invokes `ContestModel.searchAvailableStudents` and returns `{ status: 'success', count, students }`.
- **`addContestParticipant`**:
  - Validates `contestId` and `userId` payload.
  - Verifies `canManageResource(req.user, contest)`. Denies unauthorized professors with HTTP 403 and logs `PRIVILEGED_ACTION_DENIED`.
  - Evaluates runtime state via `ContestModel.getContestRuntimeState(contest)`. If `'ended'` or `'archived'`, returns HTTP 409 Conflict.
  - Validates target user: checks existence, active status (`is_active`), and strictly verifies `targetUser.role === 'student'`. Returns HTTP 400 Bad Request otherwise.
  - Checks if user is already enrolled (`isParticipantEnrolled`). Returns HTTP 409 Conflict if duplicate.
  - Inserts participant via `ContestModel.addParticipant`. Handles unique constraint concurrency race (PostgreSQL error `23505`) and returns HTTP 409 Conflict.
  - Emits `PARTICIPANT_ADDED` security audit log with actor ID, contest ID, target student ID, and runtime state.
  - Returns HTTP 201 Created with participant details.
- **`removeContestParticipant`**:
  - Validates `contestId` and `userId`.
  - Verifies `canManageResource(req.user, contest)`.
  - Evaluates runtime state: rejects deletion in ended or archived contests with HTTP 409 Conflict.
  - Checks enrollment: returns HTTP 404 Not Found if user is not a participant in this contest.
  - Historical submission check: queries `SELECT 1 FROM submissions WHERE contest_id = $1 AND user_id = $2 LIMIT 1`. If submissions exist, blocks deletion with HTTP 409 Conflict: `"Cannot remove participant: User has submitted solutions in this contest. Historical submission records must be preserved."`
  - Deletes participant via `ContestModel.removeParticipant`.
  - Emits `PARTICIPANT_REMOVED` security audit log.
  - Returns HTTP 200 OK.

### 3. `backend/src/routes/contestRoutes.js`
- Registered `GET /:id/search-students`:
  - Middleware: `authenticateToken`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, `mediumProtectionRateLimiter`.
- Registered `POST /:id/participants`:
  - Middleware: `authenticateToken`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, `contestActionRateLimiter`.
- Registered `DELETE /:id/participants/:userId`:
  - Middleware: `authenticateToken`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, `contestActionRateLimiter`.

---

## 5. Frontend Changes

### `frontend/src/components/admin/AdminContestParticipantList.jsx`
1. **Header Controls**:
   - Added "Add Participant" button (`UserPlus` icon).
   - Displayed conditionally for authorized administrators (`canManage`).
   - Dynamically disabled with informative tooltip when the contest is ended or archived (`isLifecycleLocked`).
2. **Add Participant Modal (`isAddModalOpen`)**:
   - Debounced candidate search input querying `/api/contests/:id/search-students`.
   - Candidate student list rendering: radio selector, username badge, full name, email, institution, rating tier badge.
   - Empty state when no matching unenrolled students exist.
   - Error banner if addition fails (e.g. duplicate enrollment conflict).
   - "Add to Contest" action button with spinner loading state.
3. **Table Row Actions**:
   - Updated actions column from single "View" to dual actions: "View" (inspect details) and "Remove" (`UserMinus` icon).
   - "Remove" button displayed only for managers with appropriate permissions.
   - Disabled with tooltip if contest lifecycle is locked.
4. **Remove Participant Confirmation Modal (`participantToRemove`)**:
   - Explicit confirmation prompt displaying `@username` and student full name.
   - Prominent integrity warning informing administrators that the server will block removal if historical submissions exist.
   - Inline conflict error display if removal is blocked by the server due to submissions.
   - "Confirm Removal" button with pending loading spinner and cancellation button.
5. **Lifecycle Lock Notice & Notification Banners**:
   - Yellow warning banner informing administrators when participant mutations are locked because the contest has ended or been archived.
   - Action notification banner (success/error) with dismiss trigger.

---

## 6. Validation & Business Rules

| Rule | Enforcement Location | Behavior on Violation |
|---|---|---|
| Role-Based Management | Backend Controller & Routes | 403 Forbidden (`PRIVILEGED_ACTION_DENIED`) |
| Professor Ownership (BOLA) | Backend Controller (`canManageResource`) | 403 Forbidden (Non-owner cannot modify participants) |
| Student Self-Addition via Admin API | Backend Controller | 403 Forbidden (Students cannot use admin participant endpoints) |
| Target Role Validation | Backend Controller | 400 Bad Request (Cannot add non-student roles as participants) |
| Target Active Status | Backend Controller | 400 Bad Request (Cannot add inactive students) |
| Lifecycle Mutability | Backend Controller & Frontend UI | 409 Conflict (Cannot add/remove in ended or archived contests) |
| Duplicate Enrollment | Backend Controller (`23505` catch) | 409 Conflict (User is already enrolled) |
| Submission Integrity | Backend Controller (`submissions` check) | 409 Conflict (Cannot remove participant with submissions) |
| Missing Participant Removal | Backend Controller | 404 Not Found (User is not enrolled in contest) |
| Input Boundaries | Backend Controller | 400 Bad Request (Invalid IDs, non-integers, SQL injection) |

---

## 7. RBAC & Security Analysis

- **Broken Object Level Authorization (BOLA)**:
  - Verified: Professor B attempting to add or remove a participant from Professor A's contest is rejected with HTTP 403 Forbidden and logged in `audit_logs`.
- **Privilege Escalation Protection**:
  - Verified: Student JWT tokens cannot invoke `POST /api/contests/:id/participants`, `DELETE /api/contests/:id/participants/:userId`, or `GET /api/contests/:id/search-students`. All return HTTP 403 Forbidden.
- **SQL Injection Defense**:
  - All database queries use parameterized SQL inputs (`$1, $2, ...`). Payloads containing quotes or SQL statements return HTTP 400 Bad Request without syntax or database engine errors.
- **Credential Leakage Prevention**:
  - Participant response payloads and candidate search results use an explicit column projection and never include password hashes, salt, or secrets.

---

## 8. Historical Submission Protection Strategy

- **Integrity Requirement**:
  - Once a student participates and submits code to a contest, removing their enrollment would either cause foreign key constraint violations or create orphan submission records that corrupt contest scoring and audit trails.
- **Authoritative Server-Side Guard**:
  ```sql
  SELECT 1 FROM submissions WHERE contest_id = $1 AND user_id = $2 LIMIT 1;
  ```
- **Conflict Handling**:
  - If a submission exists, the deletion request is blocked with HTTP 409 Conflict.
  - The participant row in `contest_participants` remains untouched.
  - The frontend displays a detailed error banner: *"Cannot remove participant: User has submitted solutions in this contest. Historical submission records must be preserved."*

---

## 9. Candidate Student Search Implementation

- **Endpoint**: `GET /api/contests/:id/search-students`
- **Query Parameters**:
  - `search` (string): case-insensitive substring matched against `username`, `full_name`, and `email`.
  - `limit` (integer): clamped between 1 and 50 (default: 10).
- **Exclusion Filters**:
  - Excludes users where `role != 'student'`.
  - Excludes users where `is_active = false`.
  - Strictly excludes users already in `contest_participants` for this contest.

---

## 10. Contest Lifecycle Interlocks

- **Active Running & Draft Contests**:
  - Managers can manually add and remove participants (provided removal has no submissions).
- **Ended & Archived Contests**:
  - Mutation endpoints return HTTP 409 Conflict.
  - Frontend Add button and per-row Remove buttons are disabled.
  - Clear lifecycle alert banner explains that participant enrollment and removal are closed.

---

## 11. Audit Logging Details

| Action | Actor | Target | Outcome | Metadata Recorded |
|---|---|---|---|---|
| `PARTICIPANT_ADDED` | Manager User ID | Contest ID | `success` | `studentId`, `studentUsername`, `contestId`, `runtimeState` |
| `PARTICIPANT_REMOVED` | Manager User ID | Contest ID | `success` | `studentId`, `contestId`, `runtimeState` |
| `PRIVILEGED_ACTION_DENIED` | Non-owner Professor / Student | Contest ID | `denied` | `attemptedAction`, `targetUserId` |

---

## 12. Concurrency & Race Condition Safeguards

- Simultaneous addition of the same student to a contest (e.g. rapid double-clicks or parallel requests):
  - Primary key `(contest_id, user_id)` guarantees uniqueness at the database engine level.
  - Backend catches error code `23505` (`unique_violation`) and gracefully maps it to HTTP 409 Conflict.
  - Zero unhandled 500 exceptions occur.
  - Database maintains exactly 1 participant row.

---

## 13. API Specification

### 1. Candidate Student Search
- **Route**: `GET /api/contests/:id/search-students`
- **Auth**: Bearer JWT (`professor`, `contest_admin`, `super_admin`)
- **Query**: `search` (string), `limit` (int, default 10)
- **Response 200 OK**:
  ```json
  {
    "status": "success",
    "count": 2,
    "students": [
      {
        "id": 12,
        "username": "student_alice",
        "full_name": "Alice Cooper",
        "email": "alice@univ.edu",
        "current_rating": 1350,
        "institution": "MIT"
      }
    ]
  }
  ```

### 2. Add Contest Participant
- **Route**: `POST /api/contests/:id/participants`
- **Auth**: Bearer JWT (`professor`, `contest_admin`, `super_admin`)
- **Body**: `{ "userId": 12 }`
- **Response 201 Created**:
  ```json
  {
    "status": "success",
    "message": "Participant successfully added to contest",
    "participant": {
      "contestId": 101,
      "userId": 12,
      "username": "student_alice",
      "fullName": "Alice Cooper",
      "email": "alice@univ.edu",
      "joinedAt": "2026-09-29T10:30:00.000Z"
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Invalid ID or target user is not an active student.
  - `403 Forbidden`: Non-owning professor (BOLA) or student caller.
  - `404 Not Found`: Contest or target student does not exist.
  - `409 Conflict`: User already enrolled, or contest ended/archived.

### 3. Remove Contest Participant
- **Route**: `DELETE /api/contests/:id/participants/:userId`
- **Auth**: Bearer JWT (`professor`, `contest_admin`, `super_admin`)
- **Response 200 OK**:
  ```json
  {
    "status": "success",
    "message": "Participant successfully removed from contest",
    "participant": {
      "contestId": 101,
      "userId": 12
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Malformed IDs.
  - `403 Forbidden`: Non-owning professor or student caller.
  - `404 Not Found`: Contest not found, or user not enrolled in contest.
  - `409 Conflict`: User has historical submissions in contest, or contest is ended/archived.

---

## 14. Test Suites & Results

### Backend Automated Test Suite: `backend/test_admin_phase5_7_4_manual_participant_mgmt.js`
- **Total Assertions**: 41 passed, 0 failed.
- **Coverage**:
  - Section 1: Authentication & Role-Based Access Control (A1, A2, B1, B2, C1, C2, D1, D2).
  - Section 2: Input & Target Student Validation (E1, E2, E3, E4, F1, F2, F3).
  - Section 3: Successful Addition & Duplicate Protection (K1, K2, G).
  - Section 4: Concurrency & Race Protection (H1, H2).
  - Section 5: Contest Lifecycle Restrictions (I1, I2, I3, I4, I5).
  - Section 6: Historical Submissions Dependency Protection (J1, J2, J3, J4).
  - Section 7: Removal Edge Cases (L1, L2).
  - Section 8: Candidate Student Search (M1, M2, M3, M4, M5).
  - Section 9: Security Audit Logging (P1, P2, P3).
  - Section 10: Safe Error Handling & SQL Injection Shielding (N1, N2).

### Frontend Automated UI Test Suite: `frontend/test_admin_phase5_7_4_manual_participant_mgmt_ui.js`
- **Total Assertions**: 26 passed, 0 failed.
- **Coverage**:
  - Group A: RBAC & Management Permissions (A1-A6).
  - Group B: Contest Lifecycle Lock Detection (B1-B4).
  - Group C: Candidate Student Search & Filtering (C1-C4).
  - Group D: Candidate Selection & Add Action State (D1-D4).
  - Group E: Add Participant API Response Handling (E1-E3).
  - Group F: Remove Participant Confirmation & Dependency Protection (F1-F3).
  - Group G: Visual Safeguards & Action Banners (G1-G2).

---

## 15. Full Regression Suite Results

| Test Suite | Focus Area | Result |
|---|---|---|
| `backend/test_admin_phase5_7_4_manual_participant_mgmt.js` | 7.5.7.4 Backend Manual Participant Management | **41 / 41 PASSED** |
| `frontend/test_admin_phase5_7_4_manual_participant_mgmt_ui.js` | 7.5.7.4 Frontend UI Logic & Interlocks | **26 / 26 PASSED** |
| `backend/test_admin_phase5_7_3_enrollment.js` | 7.5.7.3 Student Enrollment Backend | **25 / 25 PASSED** |
| `frontend/test_admin_phase5_7_3_enrollment_ui.js` | 7.5.7.3 Student Enrollment UI Logic | **14 / 14 PASSED** |
| `backend/test_admin_phase5_7_2_participant_list.js` | 7.5.7.2 Participant List Backend | **35 / 35 PASSED** |
| `frontend/test_admin_phase5_7_2_participant_list_ui.js` | 7.5.7.2 Participant Discovery UI Logic | **22 / 22 PASSED** |
| `backend/test_admin_phase5_6_contest_lifecycle.js` | 7.5.6 Lifecycle & Archiving | **75 / 75 PASSED** |
| `backend/test_admin_phase5_5_10_security_hardening.js` | 7.5.5.10 Security Hardening | **67 / 67 PASSED** |
| `backend/test_phase3.js` | Phase 3 Problem & Contest Foundation | **32 / 32 PASSED** |
| `frontend` (`npm run build`) | Vite Client Production Bundle Build | **SUCCESS (0 errors)** |
| `scratch/test_health.js` | Backend & Database Health Check (`/api/health`) | **200 OK (`{"server":"OK","database":"OK"}`)** |

---

## 16. Unresolved / Deferred Work

The following items are strictly out of scope for Phase 7.5.7.4 and are intentionally deferred:
- **Phase 7.5.7.5 — Bulk Participant Operations**: CSV template download, batch validation, bulk participant file upload, batch unenrollment.
- **Phase 7.5.7.6 — Advanced Eligibility & Access Validation**: Branch/department constraints, semester restrictions, prerequisite contest qualifications.
- **Phase 7.5.7.7 — Participant Status Management**: Disqualification flags, administrative warnings, proctoring penalties.
- **Phase 7.5.8+**: Live leaderboard calculations, freeze unfreeze schedules, rating updates.

---

## 17. Production Readiness Checklist

- [x] All backend routes protected with JWT authentication and RBAC middlewares.
- [x] BOLA defense verified against cross-professor unauthorized participant mutations.
- [x] Concurrency race conditions handled cleanly via PostgreSQL unique constraints.
- [x] Submission historical records protected from orphan deletion.
- [x] All database queries use parameterized prepared statements.
- [x] Sensitive user data (password hashes, secrets) shielded from all response envelopes.
- [x] Structured audit logging for all participant additions, removals, and denied attempts.
- [x] Frontend production build compiles cleanly without errors.
- [x] Full regression test suite passing with zero regressions.

---

## 18. Git Checkpoint

- **Git Commit Message**: `feat: complete phase 7.5.7.4 manual participant management`
- **Git Tag**: `phase-7.5.7.4-manual-participant-management-complete`

---

## 19. Next Phase Preparation

- **Next Phase**: **Phase 7.5.7.5 — Bulk Participant Operations**
- **Prerequisites Satisfied**:
  - Single manual addition and removal established as baseline.
  - Candidate student search query and filtering available for extension.
  - Historical submission checks and lifecycle locks already enforced.
- **Scope for 7.5.7.5**:
  - Bulk student addition via CSV/JSON list of usernames or email addresses.
  - Batch transaction safety with partial success reporting and validation error summaries.
