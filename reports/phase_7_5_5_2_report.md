# Phase 7.5.5.2 — Contest Problem List

## Goal
Establish the authoritative Admin Contest Problem List experience for ExamForge. Authorized contest managers (`super_admin`, `contest_admin`, and contest owner `professor`) can inspect problems currently attached to a contest within the Admin Contest Management drawer.

This sub-phase is strictly **READ/LIST** focused:
- No adding problems (deferred to 7.5.5.3)
- No removing problems (deferred to 7.5.5.4)
- No reordering/bulk updates (deferred to 7.5.5.5 & 7.5.5.6)
- No lifecycle mutation bypasses

---

## Architecture Reused
1. **Database Schema**: Reused existing relational schema without modifications:
   - `contest_problems (contest_id, problem_id, points, problem_order)`
   - `problems (id, title, difficulty, coding_mode, description, access_scope, is_active)`
   - `contests (id, title, status, start_time, end_time, created_by)`
2. **Authentication & RBAC Middleware**:
   - `authenticate` from [backend/src/middleware/authMiddleware.js](file:///d:/Secureexamplatform/backend/src/middleware/authMiddleware.js)
   - `authorizeRoles('professor', 'contest_admin', 'super_admin')` from [backend/src/middleware/roleMiddleware.js](file:///d:/Secureexamplatform/backend/src/middleware/roleMiddleware.js)
3. **Audit Logging Framework**:
   - `AuditLogger.logAction` from [backend/src/utils/auditLogger.js](file:///d:/Secureexamplatform/backend/src/utils/auditLogger.js)
4. **Rate Limiting**:
   - `mediumProtectionRateLimiter` from [backend/src/middleware/rateLimitMiddleware.js](file:///d:/Secureexamplatform/backend/src/middleware/rateLimitMiddleware.js)
5. **Frontend Authoring & Design System**:
   - Dark theme styling, badge color hierarchy, and `AuthoringLoadingState` component.

---

## Backend Changes
1. **Controller Implementation ([backend/src/controllers/contestController.js](file:///d:/Secureexamplatform/backend/src/controllers/contestController.js))**:
   - Added `getContestProblems(req, res)`:
     - Validates integer contest ID parameter.
     - Fetches contest record from database.
     - Enforces RBAC & BOLA (Broken Object Level Authorization):
       - `super_admin` & `contest_admin` can view attached problems for any contest.
       - `professor` can view attached problems only for contests they own (`contest.created_by === req.user.id`).
       - Unauthorized requests log `PRIVILEGED_ACTION_DENIED` to the audit log and return HTTP 403 Forbidden.
     - Joins `contest_problems` with `problems` table, ordering results by `cp.problem_order ASC, cp.problem_id ASC`.
     - Returns canonical `{ status: 'success', contestId, count, problems: [...] }` payload.
2. **Route Definition ([backend/src/routes/contestRoutes.js](file:///d:/Secureexamplatform/backend/src/routes/contestRoutes.js))**:
   - Added `GET /api/contests/:id/problems` secured behind:
     - `authenticate`
     - `authorizeRoles('professor', 'contest_admin', 'super_admin')`
     - `mediumProtectionRateLimiter`
     - Handled by `contestController.getContestProblems`.

---

## Frontend Changes
1. **Component Creation ([frontend/src/components/admin/AdminContestProblemList.jsx](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestProblemList.jsx))**:
   - Dedicated read/list view embedded inside the contest inspection drawer.
   - Automatically fetches fresh problem list from `GET /api/contests/:id/problems` on drawer inspection, eliminating stale cache.
   - Renders:
     - Header with total problem count and total points tally.
     - Refresh action button with loading spinner indicator.
     - Error state banner (`role="alert"`) with inline "Retry" action.
     - Loading state (`AuthoringLoadingState`) while fetching from backend.
     - Empty state (`role="status"`) when `problems.length === 0` ("No Problems Attached").
     - Problem items (`role="listitem"`) displaying:
       - Problem position badge (`#1`, `#2`, etc.)
       - Problem title with ellipsis overflow protection
       - Problem ID badge (`ID #101`)
       - Difficulty badge with semantic color codes (Easy: green, Medium: yellow, Hard: red)
       - Coding mode icon & badge (`Function` vs `Full Program`)
       - Points badge (`X pts`)
       - Active status badge
   - Strict read-only invariant: No Add, Remove, or Drag-and-drop handles are rendered.
2. **Container Integration ([frontend/src/components/admin/AdminContestManagement.jsx](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx))**:
   - Replaced legacy static problem display in the contest inspection drawer with `<AdminContestProblemList>`.
   - Propagates `token` and triggers contest refresh on retry.

---

## API Changes
- **Endpoint**: `GET /api/contests/:id/problems`
- **Method**: `GET`
- **Authentication**: Bearer JWT Required
- **Authorized Roles**: `professor` (ownership restricted), `contest_admin`, `super_admin`
- **Parameters**: `id` (path parameter, integer)
- **Response Format (200 OK)**:
  ```json
  {
    "status": "success",
    "contestId": 363,
    "count": 3,
    "problems": [
      {
        "problemId": 1007,
        "title": "Two Sum Phase 7.5.5.2",
        "difficulty": "easy",
        "codingMode": "function",
        "problemOrder": 1,
        "points": 100,
        "status": "active"
      },
      {
        "problemId": 1006,
        "title": "Median of Two Sorted Arrays",
        "difficulty": "hard",
        "codingMode": "full_program",
        "problemOrder": 2,
        "points": 50,
        "status": "active"
      }
    ]
  }
  ```
- **Error Responses**:
  - `401 Unauthorized`: Missing or invalid JWT
  - `403 Forbidden`: Role not authorized (e.g. `student`) or professor attempting access to another professor's contest
  - `404 Not Found`: Contest ID does not exist

---

## RBAC
| Role | Access to Own Contests | Access to Other Contests |
| :--- | :---: | :---: |
| `student` | ❌ 403 Forbidden | ❌ 403 Forbidden |
| `professor` | ✅ 200 OK | ❌ 403 Forbidden (BOLA blocked) |
| `contest_admin` | ✅ 200 OK | ✅ 200 OK |
| `super_admin` | ✅ 200 OK | ✅ 200 OK |

---

## Security
- **BOLA Protection**: Cross-professor access is strictly rejected at the database query level after verifying ownership.
- **Audit Logging**: Any rejected cross-professor access creates a `PRIVILEGED_ACTION_DENIED` entry in the `audit_logs` table recording actor ID, target contest ID, and client IP.
- **Rate Limiting**: Rate limited via `mediumProtectionRateLimiter` to protect against denial-of-service and brute-force contest enumeration.
- **Input Sanitization**: Path parameter `:id` is parsed via `parseInt(id, 10)` and checked for `isNaN` and positive bounds.

---

## Data Exposure Controls
- **Test Cases Stripping**: The backend query strictly selects metadata columns (`p.id`, `p.title`, `p.difficulty`, `p.coding_mode`, `p.is_active`, `cp.points`, `cp.problem_order`). It does NOT join `test_cases` or retrieve test inputs/outputs.
- **Hidden Problem Solutions Stripped**: Private solution code, reference implementations, and hidden problem parameters are excluded from the API response envelope.
- **Internal Database Fields Omitted**: Internal timestamps and schema metadata not relevant to contest administration are omitted.

---

## Tests Added
1. **Backend Integration Suite**: [backend/test_admin_phase5_5_2_contest_problem_list.js](file:///d:/Secureexamplatform/backend/test_admin_phase5_5_2_contest_problem_list.js)
   - Covers all 16 required invariants:
     1. Authorized admin access (`contest_admin` returns 200 OK)
     2. Authorized super_admin access (`super_admin` returns 200 OK)
     3. Authorized professor access (owner returns 200 OK)
     4. Professor ownership isolation (non-owner receives 403 Forbidden)
     5. Student role rejection (receives 403 Forbidden)
     6. Unauthenticated request rejection (receives 401 Unauthorized)
     7. Invalid contest ID (returns 404 Not Found)
     8. Contest with zero problems (returns 200 OK, count=0, empty array)
     9. Contest with multiple problems (returns correct count and list)
     10. Correct problem ordering/position (`problemOrder` ASC)
     11. Expected metadata returned (id, title, difficulty, codingMode, points, order, status)
     12. Hidden test cases NOT returned (zero testcase leakage)
     13. Solution/answer data NOT returned (zero solution leakage)
     14. Cross-resource access protection (BOLA verification)
     15. Response format conformity (`status`, `contestId`, `count`, `problems`)
     16. Database state remains unchanged (purely read-only)
2. **Frontend UI Suite**: [frontend/test_admin_phase5_5_2_contest_problem_list_ui.js](file:///d:/Secureexamplatform/frontend/test_admin_phase5_5_2_contest_problem_list_ui.js)
   - Covers:
     1. Authorized UI visibility & RBAC gate
     2. Problem list rendering & metadata formatting
     3. Empty state handling (`role="status"`, guidance text)
     4. Loading state handling (spinner display, refresh button disabled)
     5. Error state and Retry behavior (`role="alert"`, retry callback)
     6. Ordering display & array index fallbacks
     7. Scope boundary verification (NO Add, Remove, or Drag handles)
     8. Accessibility basics (`role="list"`, `role="listitem"`, `aria-label`)
     9. Security & data leak prevention in UI view models
     10. Total contest points tally calculation

---

## Targeted Test Results
- **Backend Test Suite (`test_admin_phase5_5_2_contest_problem_list.js`)**:
  - `31 PASSED, 0 FAILED` (100% passing)
- **Frontend Test Suite (`test_admin_phase5_5_2_contest_problem_list_ui.js`)**:
  - `20 PASSED, 0 FAILED` across 10 test suites (100% passing)

---

## Regression Results
| Test Suite | Result | Details |
| :--- | :---: | :--- |
| `backend/test_admin_phase5_2_contest_list.js` | **PASS** | 74 passed, 0 failed |
| `frontend/test_admin_phase5_2_contest_list_ui.js` | **PASS** | 22 passed, 0 failed |
| `backend/test_admin_phase5_3_create_contest.js` | **PASS** | 66 passed, 0 failed |
| `frontend/test_admin_phase5_3_create_contest_ui.js` | **PASS** | 22 passed, 0 failed |
| `frontend/test_admin_phase7_5_4_edit_contest_ui.js` | **PASS** | 51 passed, 0 failed |
| `backend/test_phase3.js` | **PASS** | 32 passed, 0 failed |
| `backend/test_phase_api_security.js` | **PASS** | 13 passed, 0 failed |
| `backend/test_phase5_9_2_2_deletion_safety.js` | **PASS** | 23 passed, 0 failed |
| `backend/test_phase5_9_2_4_contest_lifecycle_locks.js` | **PASS** | 26 passed, 0 failed |
| `backend/test_phase5_9_2_5_contest_problem_locks.js` | **PASS** | 31 passed, 0 failed |

---

## Build Verification
- **Command**: `npm run build` (in `frontend/`)
- **Outcome**: Successful build in 607ms
- **Output**:
  - `dist/index.html` (1.12 kB)
  - `dist/assets/index-CZH9Z1f5.css` (236.75 kB)
  - `dist/assets/index-B3dDArOe.js` (896.77 kB)
  - 0 syntax errors, 0 compilation warnings

---

## Startup / Health Verification
- **Command**: Ephemeral startup probe calling `GET /api/health`
- **HTTP Status**: `200 OK`
- **Payload**:
  ```json
  {
    "server": "OK",
    "database": "OK"
  }
  ```
- **Connection**: PostgreSQL pool closed gracefully upon completion.

---

## Known Issues
- None. All targeted tests and regression suites pass cleanly with zero flakiness.

---

## Performance Notes
- `GET /api/contests/:id/problems` executes in < 5ms via indexed primary key query on `contest_problems(contest_id, problem_id)`.
- Client-side list rendering uses lightweight CSS and SVGs without expensive dependencies.

---

## Final Status
**COMPLETE** ✅ — Phase 7.5.5.2 (Contest Problem List) is fully implemented, verified, and ready for Phase 7.5.5.3 (Add Problem to Contest).
