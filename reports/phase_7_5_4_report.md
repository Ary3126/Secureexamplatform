# Phase 7.5.4 — Edit Contest and Configuration

## Phase
- **Project**: ExamForge — Coding Practice, Competitive Programming & Secure Examination Platform
- **Phase**: Phase 7 — Admin Panel V1 Re-development
- **Sub-Phase**: Phase 7.5.4 — Edit Contest and Configuration
- **Status**: Complete

---

## Goal
Implement an authoritative, lifecycle-aware contest editing and configuration workflow for the Admin Panel. Authorized contest managers (Professors for their owned contests, Contest Admins, Super Admins) can open the Edit Contest modal from the contest table or inspection drawer, modify metadata, access scope, rating settings, and leaderboard freeze configurations, with lifecycle-aware locking on timing fields for running, ended, and archived contests, validate the inputs client-side, submit updates via `PUT /api/contests/:id`, and see instantaneous UI synchronization across tables and inspection views.

---

## Existing Infrastructure Reused
Phase 7.5.4 maintained 100% adherence to established platform conventions, reusing backend endpoints, validators, models, and CSS design tokens:
- **Database Schema**: Reused PostgreSQL `contests` table (columns: `title`, `description`, `start_time`, `end_time`, `is_rated`, `leaderboard_freeze_enabled`, `leaderboard_freeze_minutes`, `updated_at`). Zero schema changes.
- **REST API Route**: Reused `PUT /api/contests/:id` in [contestRoutes.js](file:///d:/Secureexamplatform/backend/src/routes/contestRoutes.js) with `authenticate`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, and `contestActionRateLimiter`.
- **Backend Controller**: Reused `updateContest` in [contestController.js](file:///d:/Secureexamplatform/backend/src/controllers/contestController.js).
- **Backend Service Layer**: Reused [contestService.js](file:///d:/Secureexamplatform/backend/src/services/contestService.js) (`canManageResource`, `getContestRuntimeState`) and `auditLogger.js` (`CONTEST_UPDATED`, `PRIVILEGED_ACTION_DENIED`).
- **Backend Model Layer**: Reused [contestModel.js](file:///d:/Secureexamplatform/backend/src/models/contestModel.js) (`updateContest`).
- **Backend Lifecycle Locks**: Reused backend safety checks preventing timing/schedule updates on active, ended, or archived contests (returning HTTP 409 Conflict if attempted).
- **Frontend Architecture**: Integrated with [AdminPanel.jsx](file:///d:/Secureexamplatform/frontend/src/components/AdminPanel.jsx) and [AdminContestManagement.jsx](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx).

---

## UI Changes
1. **Created `AdminContestEditModal.jsx`**:
   - Modern glassmorphic modal dialog with backdrop blur, keyboard navigation (`Escape` to close), and dirty-state protection.
   - **Pre-population**: Populates title, description, local start/end datetime strings, access scope, rating toggle, and freeze settings directly from the selected contest object.
   - **Lifecycle-Aware Timing Lock**:
     - Automatically evaluates contest status (`running`, `ended`, `archived`) and timestamp progression (`new Date() >= startTime`).
     - When locked, start and end datetime inputs are rendered disabled with `.input-locked`, preset duration buttons are hidden, and an amber warning alert explains that timing is immutable for active or past contests.
     - Automatically excludes `startTime` and `endTime` from the submission payload when locked, preventing accidental backend 409 Conflict rejection.
   - **Draft/Upcoming Full Editing**:
     - When contest is in `draft` or `upcoming` state, all fields including schedule timing and duration presets (+1h, +2h, +3h, +5h, +24h) remain fully editable.
   - **Rating & Leaderboard Freeze Controls**:
     - Interactive toggle switches for Elo rating participation and leaderboard freeze masking.
     - Dynamic freeze minutes input with client-side bounds checking (0 <= freezeMinutes <= contestDuration).
   - **Dirty State Guard**:
     - Tracks changes relative to initial values; clicking Cancel or pressing Escape when changes are unsaved prompts confirmation (`window.confirm`) to prevent accidental data loss.
   - **Error Handling**:
     - Displays formatted server-side validation error messages via dismissible red banner.
2. **Updated `AdminContestManagement.jsx`**:
   - Imported `AdminContestEditModal` and `Edit3` Lucide icon.
   - Added `editContest` state tracking the target contest for editing.
   - Implemented `canManageContest(contest)` RBAC helper checking if the current user is a Super Admin, Contest Admin, or the owning Professor.
   - Added an **Edit** action button (`.contest-action-btn.edit`) to table rows for authorized managers.
   - Implemented `handleEditSubmit(contestId, payload)` delegating to `onUpdateContest` prop and closing the modal on success.
3. **Updated `AdminPanel.jsx` (`ContestsSection`)**:
   - Added `isEditing` state.
   - Implemented `handleUpdateContest(contestId, updateData)` executing `PUT /api/contests/:id`.
   - On success: triggers `fetchContests()` to refresh the table and updates `inspectedContest` if the currently inspected contest matches the edited one.
   - Threaded `onUpdateContest` and `isEditing` down to `AdminContestManagement`.
4. **Updated `adminContestManagement.css`**:
   - Added `.contest-modal-backdrop` ensuring proper modal overlay centering and backdrop blur across both create and edit modals.
   - Added `.input-locked` utility class specifying disabled styling, locked border, and `cursor: not-allowed`.

---

## Form Fields & Mutability Rules
| Field | Type | Draft / Upcoming | Running / Ended / Archived | Validation Rules |
|---|---|---|---|---|
| `title` | string | Editable | Editable | 3–200 characters |
| `description` | string | Editable | Editable | <= 10,000 characters |
| `startTime` | datetime-local | Editable | **LOCKED** (Omitted from payload) | Valid ISO 8601, required if editable |
| `endTime` | datetime-local | Editable | **LOCKED** (Omitted from payload) | Strictly later than startTime (>= 1m) |
| `accessScope` | select enum | Editable | Editable | `'public'` \| `'private'` |
| `isRated` | boolean | Editable | Editable | Strict boolean |
| `leaderboardFreezeEnabled` | boolean | Editable | Editable | Strict boolean |
| `leaderboardFreezeMinutes` | integer | Editable | Editable | 0 <= freezeMinutes <= durationMinutes |

---

## Validation
1. **Frontend Validation (`AdminContestEditModal.jsx`)**:
   - Title: Required, trimmed length between 3 and 200 characters.
   - Description: Optional, maximum 10,000 characters.
   - Schedule (only if unlocked): Start and end times required; `endTime > startTime`; duration at least 1 minute.
   - Freeze Minutes: Non-negative integer; cannot exceed total contest duration.
2. **Backend Validation (`validateUpdateContest`)**:
   - Enforces bounds on any supplied fields.
   - Rejects lifecycle mutations (changing start/end times on running, ended, or archived contests) with HTTP 409 Conflict.
   - Validates that `endTime > startTime` when dates are updated.

---

## API Contract
- **Endpoint**: `PUT /api/contests/:id`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <token>`
- **Access Control**: Authenticated `professor` (owner only), `contest_admin`, `super_admin`
- **Request Body (Draft / Upcoming)**:
  ```json
  {
    "title": "Updated Hackathon Sprint 2026",
    "description": "Revised guidelines and scoring rubrics",
    "startTime": "2026-11-01T09:00:00.000Z",
    "endTime": "2026-11-01T14:00:00.000Z",
    "accessScope": "public",
    "isRated": true,
    "leaderboardFreezeEnabled": true,
    "leaderboardFreezeMinutes": 45
  }
  ```
- **Request Body (Running Contest — Timing Omitted)**:
  ```json
  {
    "title": "Live Hackathon Sprint 2026 (Clarified Title)",
    "description": "Added FAQ section during the live contest",
    "accessScope": "public",
    "isRated": true,
    "leaderboardFreezeEnabled": true,
    "leaderboardFreezeMinutes": 45
  }
  ```
- **Success Response (`200 OK`)**:
  ```json
  {
    "message": "Contest updated successfully",
    "contest": {
      "id": 349,
      "title": "Updated Hackathon Sprint 2026",
      "description": "Revised guidelines and scoring rubrics",
      "startTime": "2026-11-01T09:00:00.000Z",
      "endTime": "2026-11-01T14:00:00.000Z",
      "status": "draft",
      "runtimeState": "draft",
      "isRated": true,
      "leaderboardFreezeEnabled": true,
      "leaderboardFreezeMinutes": 45,
      "createdBy": 2170,
      "updatedAt": "2026-09-27T16:32:06.462Z"
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Validation failure on field values.
  - `401 Unauthorized`: Missing or invalid JWT.
  - `403 Forbidden`: Non-owner professor or unauthorized role attempting modification.
  - `404 Not Found`: Contest ID does not exist.
  - `409 Conflict`: Attempted to mutate lifecycle timing fields (`startTime`, `endTime`) on an active, ended, or archived contest.

---

## Authorization
- **Student**: Forbidden at API route level (`authorizeRoles`), Edit button hidden in UI.
- **Professor**: Permitted to edit only contests they created (`contest.createdBy === user.id`). Other professors' contests do not render Edit buttons and backend returns 403 Forbidden.
- **Contest Admin & Super Admin**: Permitted to edit any contest across the platform.

---

## Database Changes
- **Zero schema changes**: All fields exist in the PostgreSQL `contests` table.

---

## Tests Added & Results

### 1. Phase 7.5.4 Frontend UI Logic Test Suite
- **File**: [frontend/test_admin_phase7_5_4_edit_contest_ui.js](file:///d:/Secureexamplatform/frontend/test_admin_phase7_5_4_edit_contest_ui.js)
- **Command**: `node frontend/test_admin_phase7_5_4_edit_contest_ui.js`
- **Test Categories**:
  - Form pre-population from draft, upcoming, running, ended, and archived contest models
  - Lifecycle lock detection logic (status-based and timestamp-based)
  - Payload construction (proper omission of timing when locked, inclusion when unlocked)
  - Form validation rules (title length, description bounds, date ordering, freeze window limits)
  - Dirty-state tracking for unsaved change warnings
  - RBAC visibility rules for Edit action buttons
  - API error response envelope parsing
- **Results**: **51 / 51 PASSED** (0 failed)

### 2. Backend Contest Lifecycle Locks Test Suite
- **File**: [backend/test_phase5_9_2_4_contest_lifecycle_locks.js](file:///d:/Secureexamplatform/backend/test_phase5_9_2_4_contest_lifecycle_locks.js)
- **Command**: `node backend/test_phase5_9_2_4_contest_lifecycle_locks.js`
- **Results**: **26 / 26 PASSED** (0 failed)

### 3. Phase 7.5.3 Create Contest Regression Suite
- **File**: [frontend/test_admin_phase5_3_create_contest_ui.js](file:///d:/Secureexamplatform/frontend/test_admin_phase5_3_create_contest_ui.js)
- **Command**: `node frontend/test_admin_phase5_3_create_contest_ui.js`
- **Results**: **22 / 22 PASSED** (0 failed)

---

## Build Verification
- **Command**: `npm run build` in `frontend/`
- **Result**: `✓ built in 714ms` (0 errors).

---

## Known Issues
- None in Phase 7.5.4.
- Contest Problem Management (attaching problems, setting points, problem reordering) is reserved for Phase 7.5.5.

---

## Final Status
**PHASE 7.5.4 — EDIT CONTEST AND CONFIGURATION IS COMPLETE.**
Per the strict stop rule, Phase 7.5.5 (Contest Problem Management) has NOT been started.
