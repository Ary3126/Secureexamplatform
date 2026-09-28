# Phase 7.5.5.3 — Add Problem to Contest

## Phase
- **Project**: ExamForge — Coding Practice, Competitive Programming & Secure Examination Platform
- **Phase**: Phase 7 — Admin Panel V1 Re-development
- **Sub-Phase**: Phase 7.5.5.3 — Add Problem to Contest
- **Status**: Complete

---

## Goal
Enable authorized contest managers (`super_admin`, `contest_admin`, and owner `professor`) to attach an existing problem from the problem bank to an existing contest. Provide an intuitive search, selection, and configuration workflow in the Admin Contest Management drawer while strictly enforcing RBAC, contest lifecycle locks, duplicate prevention, concurrency safety, problem access eligibility, and data leak prevention.

---

## Architecture Reused
1. **Relational Join Table**:
   - `contest_problems (contest_id, problem_id, problem_order, points)`
   - Primary key on `(contest_id, problem_id)` enforcing uniqueness.
2. **Authoritative REST Endpoint**:
   - Reused existing `POST /api/contests/:id/problems` secured behind `authenticate`, `authorizeRoles('professor', 'contest_admin', 'super_admin')`, `contestActionRateLimiter`, and `validateAddProblemToContest`.
3. **Transactional Row Locking**:
   - Reused `ContestModel.addProblemToContestWithSafety` executing within isolated PostgreSQL transactions (`BEGIN ... SELECT ... FOR UPDATE ... COMMIT`).
4. **Lifecycle Locks**:
   - Authoritative state evaluation via `getContestRuntimeState(contest)` and `isLifecycleMutationLocked(runtimeState)`.
5. **Problem Catalog Endpoint**:
   - Reused `GET /api/problems` for server-side problem discovery with role-aware visibility.

---

## Audit Findings
- **Endpoint Parity**: An existing route and controller for `POST /api/contests/:id/problems` existed but lacked parameter validation on `contestId`, had a default parameter `problemOrder = 1` which shadowed auto-increment calculation, did not check professor problem access eligibility for private questions, and had not yet been integrated into the frontend UI.
- **Frontend Need**: `AdminContestProblemList.jsx` created in 7.5.5.2 was strictly read/list. It required an "Add Problem" trigger, problem search dialog, already-attached detection, and refreshed server state upon attachment.

---

## Backend Changes
1. **Model Hardening ([backend/src/models/contestModel.js](file:///d:/Secureexamplatform/backend/src/models/contestModel.js))**:
   - Removed shadowing default in `addProblemToContestWithSafety({ contestId, problemId, points = 100, problemOrder })`.
   - Auto-assigned next problem order using `COALESCE(MAX(problem_order), 0) + 1` whenever `problemOrder` is omitted or invalid.
   - Handled PostgreSQL unique violation error code `23505` to safely return `{ success: false, duplicate: true }` under race conditions.
2. **Controller Hardening ([backend/src/controllers/contestController.js](file:///d:/Secureexamplatform/backend/src/controllers/contestController.js))**:
   - Validated positive integer formats for both `req.params.id` and `req.body.problemId`.
   - Enforced BOLA and problem eligibility: Professors are forbidden (HTTP 403) from attaching other professors' `contest_private` or unpublished problems.
   - Preserved `mapping` and returned enriched, leak-free `problem` metadata (`problemId`, `title`, `difficulty`, `codingMode`, `points`, `problemOrder`, `status`).
3. **Validation Middleware ([backend/src/middleware/contestValidation.js](file:///d:/Secureexamplatform/backend/src/middleware/contestValidation.js))**:
   - Added validation for `req.params.id` ensuring invalid non-integer IDs return HTTP 400 Bad Request.

---

## Frontend Changes
1. **Component Extension ([frontend/src/components/admin/AdminContestProblemList.jsx](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestProblemList.jsx))**:
   - Added `[ + Add Problem ]` button in header, rendered only for authorized managers (`super_admin`, `contest_admin`, or contest creator `professor`).
   - Disabled the button with contextual tooltip when contest is in a locked lifecycle state (`running`, `ended`, `archived`).
   - Integrated "Add Problem to Contest" modal dialog (`role="dialog"`, `aria-modal="true"`):
     - Search input with debounced query execution against `/api/problems`.
     - Difficulty filter dropdown (`all`, `easy`, `medium`, `hard`).
     - Contest points input (defaults to 100).
     - Problem results list showing title, ID, difficulty badge, and coding mode badge.
     - Already-attached detection: Attached problems display an "Already Attached" badge and are disabled from selection.
     - Selection state highlighting chosen problem.
     - Modal error banner displaying specific server failure messages (401, 403, 404, 409, 422, 429, 500, network errors).
     - Double-submission guard disabling action button during submission (`isSubmitting`).
   - Post-addition workflow: Closes modal, shows success toast notification, refetches attached problem list, and triggers parent drawer refresh.
2. **Container Update ([frontend/src/components/admin/AdminContestManagement.jsx](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx))**:
   - Forwarded `contest={inspectedContest}`, `currentUser={currentUser}`, and `onProblemAdded` callback to `<AdminContestProblemList />`.

---

## API Changes
- **Endpoint**: `POST /api/contests/:id/problems`
- **Method**: `POST`
- **Authentication**: Bearer JWT Required
- **Authorized Roles**: `professor` (ownership restricted), `contest_admin`, `super_admin`
- **Request Body**:
  ```json
  {
    "problemId": 1024,
    "points": 250,
    "problemOrder": 3
  }
  ```
- **Success Response (`201 Created`)**:
  ```json
  {
    "status": "success",
    "message": "Problem added to contest successfully",
    "mapping": {
      "contestId": 392,
      "problemId": 1024,
      "points": 250,
      "problemOrder": 3
    },
    "problem": {
      "problemId": 1024,
      "title": "Public Dynamic Programming Problem",
      "difficulty": "hard",
      "codingMode": "function",
      "points": 250,
      "problemOrder": 3,
      "status": "active"
    }
  }
  ```
- **Error Codes**:
  - `400 Bad Request`: Missing/invalid `problemId` or non-integer `contestId`
  - `401 Unauthorized`: Missing or invalid JWT
  - `403 Forbidden`: Student role, professor modifying another professor's contest, or professor attempting to attach another's private problem
  - `404 Not Found`: Contest or problem does not exist
  - `409 Conflict`: Problem already attached or contest is lifecycle locked (`running`, `ended`, `archived`)
  - `429 Too Many Requests`: Rate limit exceeded

---

## RBAC
| Actor | Own Contest | Other Professor Contest | Private Problem of Other Prof |
| :--- | :---: | :---: | :---: |
| `student` | ❌ 403 Forbidden | ❌ 403 Forbidden | ❌ 403 Forbidden |
| `professor` | ✅ 201 Created | ❌ 403 Forbidden | ❌ 403 Forbidden |
| `contest_admin` | ✅ 201 Created | ✅ 201 Created | ✅ 201 Created |
| `super_admin` | ✅ 201 Created | ✅ 201 Created | ✅ 201 Created |

---

## Lifecycle Enforcement
- **`draft`**: Adding problems allowed.
- **`upcoming`**: Adding problems allowed prior to start time.
- **`running`**: Strictly locked. Returns `HTTP 409 Conflict` (`"Cannot mutate problems while contest is running"`).
- **`ended`**: Strictly locked. Returns `HTTP 409 Conflict` (`"Cannot mutate problems for concluded contest"`).
- **`archived`**: Strictly locked. Returns `HTTP 409 Conflict` (`"Cannot mutate problems for archived contest"`).

---

## Validation
- Server-side validation of positive integers for `contestId`, `problemId`, `points`, and `problemOrder`.
- Automatic fallback: If `points` is omitted, defaults to 100.
- Automatic position: If `problemOrder` is omitted, auto-assigned to `MAX(problem_order) + 1`.

---

## Duplicate Protection
- Server-side existence check under row lock (`SELECT 1 FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`).
- Database primary key constraint `PRIMARY KEY (contest_id, problem_id)`.
- Concurrent duplicate requests serialize under row lock; exactly 1 request returns 201 Created while concurrent duplicate requests receive 409 Conflict.
- Client-side pre-filtering disables selection of already-attached problems in search results.

---

## Concurrency / Transaction Safety
- Explicit `SELECT id FROM contests WHERE id = $1 FOR UPDATE` locks the contest record during problem attachment.
- All actions execute in atomic `BEGIN ... COMMIT` blocks; any error triggers automatic `ROLLBACK`.

---

## Audit Logging
- Successful problem attachment logs `CONTEST_PROBLEM_ADDED` with actor ID, problem ID, points, and assigned problem order.
- Unauthorized attempts log `PRIVILEGED_ACTION_DENIED` with actor identity and target resource.
- No sensitive test cases or solutions are ever logged.

---

## Data Integrity
- Attaching a problem does NOT mutate `submissions`, `contest_participants`, rating history, or problem definitions.
- Verified by automated tests inspecting submission counts and participant counts before and after attachment operations.

---

## Tests Added
1. **Backend Integration Suite**: [backend/test_admin_phase5_5_3_add_problem.js](file:///d:/Secureexamplatform/backend/test_admin_phase5_5_3_add_problem.js) (42 assertions across 25 categories)
2. **Frontend UI Suite**: [frontend/test_admin_phase5_5_3_add_problem_ui.js](file:///d:/Secureexamplatform/frontend/test_admin_phase5_5_3_add_problem_ui.js) (24 assertions across 7 test suites)

---

## Targeted Test Results
- **Backend Test Suite (`test_admin_phase5_5_3_add_problem.js`)**:
  - `42 PASSED, 0 FAILED` (100% pass)
- **Frontend Test Suite (`test_admin_phase5_5_3_add_problem_ui.js`)**:
  - `24 PASSED, 0 FAILED` (100% pass)

---

## Regression Results
| Test Suite | Result | Details |
| :--- | :---: | :--- |
| `backend/test_admin_phase5_5_3_add_problem.js` | **PASS** | 42 passed, 0 failed |
| `frontend/test_admin_phase5_5_3_add_problem_ui.js` | **PASS** | 24 passed, 0 failed |
| `backend/test_admin_phase5_5_2_contest_problem_list.js` | **PASS** | 31 passed, 0 failed |
| `frontend/test_admin_phase5_5_2_contest_problem_list_ui.js` | **PASS** | 20 passed, 0 failed |
| `backend/test_admin_phase5_3_create_contest.js` | **PASS** | 66 passed, 0 failed |
| `frontend/test_admin_phase5_3_create_contest_ui.js` | **PASS** | 22 passed, 0 failed |
| `frontend/test_admin_phase7_5_4_edit_contest_ui.js` | **PASS** | 51 passed, 0 failed |
| `backend/test_phase3.js` | **PASS** | 32 passed, 0 failed |
| `backend/test_phase_api_security.js` | **PASS** | 13 passed, 0 failed |
| `backend/test_phase5_9_2_2_deletion_safety.js` | **PASS** | 23 passed, 0 failed |
| `backend/test_phase5_9_2_4_contest_lifecycle_locks.js` | **PASS** | 26 passed, 0 failed |
| `backend/test_phase5_9_2_5_contest_problem_locks.js` | **PASS** | 31 passed, 0 failed |

---

## Security Testing
- **BOLA Protection**: Verified that Professor B cannot attach problems to Professor A's contest (returns 403 Forbidden).
- **Private Problem Isolation**: Verified that Professor A cannot attach Professor B's `contest_private` problem (returns 403 Forbidden).
- **Student Rejection**: Verified that students are blocked with 403 Forbidden.
- **Unauthenticated Requests**: Blocked with 401 Unauthorized.
- **Data Leak Prevention**: Response body confirmed to contain zero test case arrays or solution source code.

---

## Build Verification
- **Command**: `npm run build` (in `frontend/`)
- **Outcome**: Succeeded in 643ms with 0 compilation errors.

---

## Startup / Health Verification
- **Command**: `GET /api/health` against ephemeral startup probe
- **Status**: `200 OK`
- **Body**:
  ```json
  {
    "server": "OK",
    "database": "OK"
  }
  ```

---

## Known Issues
- None. All targeted tests and regression suites pass cleanly.

---

## Performance Notes
- Problem addition operates in < 10ms utilizing transactional row-level lock and indexed foreign key queries.
- Problem search dialog uses debounced 250ms query triggering and capped limit of 20 results.

---

## Final Status
**COMPLETE** ✅ — Phase 7.5.5.3 (Add Problem to Contest) is fully implemented, verified, and ready for Phase 7.5.5.4 (Remove Problem from Contest).

---

## Git Checkpoint
- **Commit**: `Phase 7.5.5.3: Add Problem to Contest`
- **Tag**: `phase-7.5.5.3-add-problem-complete`
