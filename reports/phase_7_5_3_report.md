# Phase 7.5.3 — Create Contest Workflow

## Phase
- **Project**: ExamForge — Coding Practice, Competitive Programming & Secure Examination Platform
- **Phase**: Phase 7 — Admin Panel V1 Re-development
- **Sub-Phase**: Phase 7.5.3 — Create Contest Workflow
- **Status**: Complete

---

## Goal
Implement a robust, production-grade Admin Contest Creation workflow utilizing the existing backend contest architecture. Authorized contest managers (Professors, Contest Admins, Super Admins) can open the Create Contest modal, configure metadata, dates/timing, access scope, Elo rating rules, and leaderboard freeze settings, validate the form, create the contest in authoritative `draft` status, and return seamlessly to the updated contest list.

---

## Existing Infrastructure Reused
Phase 7.5.3 strictly adhered to the architecture established in Phase 7.5.1 and 7.5.2, maximizing reuse without duplicating schemas, routes, or state machines:
- **Database Schema**: Reused PostgreSQL `contests` table (columns: `title`, `description`, `start_time`, `end_time`, `created_by`, `status`, `is_rated`, `leaderboard_freeze_enabled`, `leaderboard_freeze_minutes`). Zero schema migrations or table alterations.
- **REST API Route**: Reused `POST /api/contests` in [contestRoutes.js](file:///d:/Secureexamplatform/backend/src/routes/contestRoutes.js) with existing `authenticate`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, and `contestActionRateLimiter`.
- **Backend Controller**: Reused `createContest` in [contestController.js](file:///d:/Secureexamplatform/backend/src/controllers/contestController.js).
- **Backend Service Layer**: Reused [contestService.js](file:///d:/Secureexamplatform/backend/src/services/contestService.js) (`formatContest`, `getContestRuntimeState`, `canManageResource`) and `auditLogger.js` (`CONTEST_CREATED`).
- **Backend Model Layer**: Reused [contestModel.js](file:///d:/Secureexamplatform/backend/src/models/contestModel.js) (`createContestWithSafety`, `createContest`).
- **Frontend Architecture**: Integrated with [AdminPanel.jsx](file:///d:/Secureexamplatform/frontend/src/components/AdminPanel.jsx) and [AdminContestManagement.jsx](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx).

---

## UI Changes
1. **Created `AdminContestCreateModal.jsx`**:
   - Modern glassmorphic dialog with accessible backdrop, keyboard navigation (`Escape` to close), and unsaved changes confirmation.
   - Distinct sections: Basic Information, Schedule & Timing, Access Scope & Visibility, Scoring & Leaderboard Freeze.
   - Quick duration preset chips: `+1h`, `+2h`, `+3h`, `+5h`, `+24h` for instant schedule adjustments.
   - Dynamic duration preview pill (e.g., `Duration: 2h 0m`).
   - Access scope selector (`Public Contest` vs `Private / Examination`).
   - Informative `Draft Mode` policy badge and status explanation.
   - Rating toggle switch with real-time explanatory text.
   - Leaderboard freeze toggle switch with conditional freeze window input (in minutes) and bound checking.
   - Debounced submit button with animated spinner (`Creating Contest...`) and multi-click defense.
   - Server-side error banner parsing both array and string error payloads.
2. **Updated `AdminContestManagement.jsx`**:
   - Replaced placeholder alert on the header "New Contest" button with a trigger opening `AdminContestCreateModal`.
   - Role-gated the "New Contest" button (hidden from student roles).
   - Enhanced the empty state: when zero contests exist and no filters are active, a primary "Create First Contest" action is displayed for authorized users.
   - Wired creation lifecycle callback to close the modal upon success and retain user input on failure.
3. **Updated `AdminPanel.jsx` (`ContestsSection`)**:
   - Added `isCreating` state management.
   - Implemented `handleCreateContest(contestData)` communicating with `POST /api/contests`.
   - Wired automatic post-creation workflow: refreshes the contest list (`fetchContests`) and opens the newly created draft contest in the inspection drawer (`handleInspectContest`).

---

## Form Fields
The contest creation form exposes only fields natively supported by the backend:
- `title` (string, required): Contest Title (3–200 characters).
- `description` (string, optional): Detailed Contest Instructions and Guidelines (up to 10,000 characters).
- `startTime` (datetime-local, required): Local start date and time, converted to UTC ISO 8601 string.
- `endTime` (datetime-local, required): Local end date and time, strictly later than start time.
- `accessScope` (string, enum: `'public'` | `'private'`): Access scope indicating participant visibility upon publishing.
- `isRated` (boolean, default: `true`): Competitive Elo rating toggle.
- `leaderboardFreezeEnabled` (boolean, default: `false`): Enables scoreboard masking before contest conclusion.
- `leaderboardFreezeMinutes` (integer, default: `60`): Window (in minutes) prior to end time when standings freeze.

---

## Validation
1. **Frontend Validation (`AdminContestCreateModal.jsx`)**:
   - Title: Required, trimmed length between 3 and 200 characters.
   - Description: Max 10,000 characters.
   - Start Time: Valid date, required.
   - End Time: Valid date, required, strictly later than start time, minimum duration >= 1 minute.
   - Freeze Minutes: Non-negative integer, cannot exceed total contest duration.
2. **Backend Authoritative Validation (`contestValidation.js` -> `validateCreateContest`)**:
   - `title`: String, length 3 to 200 characters.
   - `startTime` & `endTime`: Valid ISO 8601 date strings.
   - Date ordering: `endTime > startTime` and duration >= 1 minute.
   - `description`: If provided, must be string <= 10,000 characters.
   - `accessScope` & `visibility`: If provided, must be in `['public', 'private', 'restricted']`.
   - `isRated`: If provided, must be strict boolean.
   - `leaderboardFreezeEnabled`: If provided, must be strict boolean.
   - `leaderboardFreezeMinutes`: If provided, non-negative integer <= total contest duration in minutes.
   - `durationMinutes`: If provided, positive integer.
   - Returns structured `400 Bad Request` with `{ status: 'error', statusCode: 400, message: 'Contest validation failed', errors: [...] }`.

---

## Backend Changes
1. **`contestValidation.js`**:
   - Enhanced `validateCreateContest` to validate description bounds, `accessScope`, `isRated`, `leaderboardFreezeEnabled`, and `leaderboardFreezeMinutes` duration bounds.
2. **`contestModel.js`**:
   - Added `ContestModel.findRecentDuplicate({ title, createdBy, withinSeconds })` to query rapid identical draft contest submissions.
3. **`contestController.js`**:
   - Integrated duplicate multi-click check into `createContest`: identical title by the same creator within 3 seconds returns `409 Conflict` with `duplicateContestId`, preventing duplicate database records.

---

## API Contract
- **Endpoint**: `POST /api/contests`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <token>`
- **Access Control**: Authenticated `professor`, `contest_admin`, `super_admin`
- **Request Body**:
  ```json
  {
    "title": "ACM-ICPC Qualifier 2026",
    "description": "Annual programming sprint",
    "startTime": "2026-10-15T10:00:00.000Z",
    "endTime": "2026-10-15T13:00:00.000Z",
    "accessScope": "public",
    "isRated": true,
    "leaderboardFreezeEnabled": true,
    "leaderboardFreezeMinutes": 60
  }
  ```
- **Success Response (`201 Created`)**:
  ```json
  {
    "message": "Contest created successfully in draft mode",
    "contest": {
      "id": 296,
      "title": "ACM-ICPC Qualifier 2026",
      "description": "Annual programming sprint",
      "startTime": "2026-10-15T10:00:00.000Z",
      "endTime": "2026-10-15T13:00:00.000Z",
      "status": "draft",
      "runtimeState": "draft",
      "isRated": true,
      "isRatingFinalized": false,
      "leaderboardFreezeEnabled": true,
      "leaderboardFreezeMinutes": 60,
      "createdBy": 1995,
      "createdAt": "2026-09-27T15:59:38.380Z",
      "updatedAt": "2026-09-27T15:59:38.380Z"
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Input validation failed (`{ status: 'error', statusCode: 400, errors: [...] }`).
  - `401 Unauthorized`: Missing or invalid JWT.
  - `403 Forbidden`: Role not authorized (e.g. Student).
  - `409 Conflict`: Multi-click duplicate detected within 3 seconds.

---

## Authorization
- **Student**: Rebuffed with HTTP 403 Forbidden at route level (`authorizeRoles`). "New Contest" buttons hidden in the UI.
- **Professor**: Permitted to create draft contests. Newly created contest is bound to `createdBy = req.user.id`.
- **Contest Admin & Super Admin**: Permitted to create draft contests platform-wide.

---

## Time Handling
- **Datetime Picker**: Uses `<input type="datetime-local" />` in local user timezone.
- **Payload Transmission**: Explicitly converted to UTC ISO 8601 strings (`.toISOString()`) before POST transmission.
- **Server Clock Authority**: PostgreSQL stores `TIMESTAMP WITH TIME ZONE`. Dynamic runtime state derivation remains server-authoritative.

---

## Rating Configuration
- Configured via `isRated` (boolean).
- If `true`: Contest is marked as rated; finalization in Phase 7.5.9 will update user Elo ratings.
- If `false`: Contest is unrated; practice/exam scores are recorded without affecting ratings.

---

## Leaderboard Freeze Configuration
- Configured via `leaderboardFreezeEnabled` (boolean) and `leaderboardFreezeMinutes` (integer).
- Verified that freeze minutes cannot exceed total contest duration.

---

## Database Changes
- **Zero database changes**: All fields exist in the `contests` table.

---

## Tests Added/Updated
1. **Backend Integration Suite**: [backend/test_admin_phase5_3_create_contest.js](file:///d:/Secureexamplatform/backend/test_admin_phase5_3_create_contest.js)
   - 66 test assertions covering:
     - Authorized creation (Professor, Contest Admin, Super Admin)
     - Student and guest rejection (403 and 401)
     - Title validation (missing, <3 chars, >200 chars, non-string)
     - Description validation (non-string, length bounds)
     - Date validation (missing, malformed, end <= start, <1m duration)
     - Access scope validation (enums)
     - Rating validation (non-boolean rejection)
     - Freeze validation (negative, non-integer, freeze > duration)
     - Valid draft creation (`status='draft'`, `runtimeState='draft'`)
     - Creator ownership and audit logging
     - Database persistence verification via direct SQL query
     - Discovery isolation (visible to creator, hidden from students and other professors)
     - Rapid duplicate submit protection (409 Conflict)
     - API error envelope structure
2. **Frontend UI Logic Suite**: [frontend/test_admin_phase5_3_create_contest_ui.js](file:///d:/Secureexamplatform/frontend/test_admin_phase5_3_create_contest_ui.js)
   - 22 tests covering:
     - Create button RBAC visibility
     - Form defaults and structure
     - Title requirement and length rules
     - Date ordering and duration presets
     - Rating controls and serialization
     - Leaderboard freeze bounds
     - UTC ISO serialization
     - Error response envelope parsing

---

## Test Results

### 1. Phase 7.5.3 Backend Suite
```
node backend/test_admin_phase5_3_create_contest.js
```
- **Passed**: 66 / 66
- **Failed**: 0
- **Duration**: ~2.1s

### 2. Phase 7.5.3 Frontend Suite
```
node frontend/test_admin_phase5_3_create_contest_ui.js
```
- **Passed**: 22 / 22
- **Failed**: 0
- **Duration**: ~17ms

---

## Regression Results
All existing and previous test suites passed with 100% success rate:
- **`backend/test_admin_phase5_2_contest_list.js`**: **74 / 74 PASSED**
- **`frontend/test_admin_phase5_2_contest_list_ui.js`**: **22 / 22 PASSED**
- **`backend/test_phase3.js`**: **32 / 32 PASSED**
- **`backend/test_phase_api_security.js`**: **13 / 13 PASSED**
- **`backend/test_phase5_9_2_2_deletion_safety.js`**: **23 / 23 PASSED**
- **`backend/test_phase5_9_2_4_contest_lifecycle_locks.js`**: **26 / 26 PASSED**
- **`backend/test_phase5_9_2_5_contest_problem_locks.js`**: **31 / 31 PASSED**
- **`frontend/test_admin_phase1_shell.js`**: **7 / 7 PASSED**
- **`frontend/test_admin_phase2_dashboard.js`**: **7 / 7 PASSED**
- **`frontend/test_admin_phase3_users.js`**: **10 / 10 PASSED**
- **`frontend/test_admin_phase4_1_problems_ui.js`**: **14 / 14 PASSED**

---

## Security Verification
1. **RBAC Hardening**: Students and unauthenticated callers receive 403 / 401 respectively upon attempting creation.
2. **Ownership Binding**: Contest records bind directly to authenticated `req.user.id`; client cannot spoof `createdBy`.
3. **Audit Trail**: Every contest creation generates a structured `CONTEST_CREATED` audit log entry in `audit_logs`.
4. **Draft Privacy**: Newly created contests are in `draft` mode and are hidden from students and non-owner professors.
5. **Multi-Click Defenses**: Client submit button disables immediately, and backend debounces identical titles by the same creator within 3 seconds with HTTP 409.

---

## Build Verification
- **Command**: `npm run build` in `frontend/`
- **Result**: `✓ built in 576ms` (0 syntax or bundling errors).

---

## Startup Verification
- **Command**: Ephemeral startup probe on `backend/src/server.js`
- **Result**: Server bound to port and accepted traffic cleanly.

---

## Health Check
- **Endpoint**: `GET /api/health`
- **Result**: `HTTP 200 OK`, `{"server":"OK","database":"OK"}`.

---

## Known Issues
- None in Phase 7.5.3.
- Contest problem attachment and lifecycle publishing workflows are reserved for Phase 7.5.5 and 7.5.6.

---

## Performance Notes
- Fast single-row insert within an atomic database transaction.
- Duplicate submission check performs indexed lookup on `(created_by, lower(title), created_at)` completing in < 1ms.

---

## Final Status
**PHASE 7.5.3 — CREATE CONTEST WORKFLOW IS COMPLETE.**
Per the strict stop rule, Phase 7.5.4 (Edit Contest Workflow) has NOT been started.
