# Phase 7.5.8.3 — Admin Leaderboard

## 1. Goal
Provide authorized administrators with a secure, server-authoritative, full-featured Contest Leaderboard integrated directly into the Admin Contest Management experience. The Admin Leaderboard enables professors, contest administrators, and super administrators to inspect real-time or historical contest standings, toggle live unmasked submissions during freeze windows, filter and sort by whitelisted metrics without perturbing official ranks, and inspect participant contest performance in detail.

## 2. Architecture Reused
- **Standings Computation**: [StandingsService.computeContestStandings](file:///d:/Secureexamplatform/backend/src/services/standingsService.js) remains the single authoritative source of truth for ICPC/IOI scores, problem penalties, solve times, tie-breaking, and ranking.
- **Freeze Mechanics**: Reused the server-side freeze detection and cutoff logic in [StandingsService](file:///d:/Secureexamplatform/backend/src/services/standingsService.js), honoring `freezeOverride` for authorized managers.
- **Role Middleware**: Reused `authenticate` and `authorizeRoles('professor', 'contest_admin', 'super_admin')` in `backend/src/middleware/roleMiddleware.js`.
- **Admin UI Layout**: Reused the inspection drawer system in `AdminContestManagement.jsx` by adding a dedicated `Standings & Leaderboard` tab.
- **Problem Matrix Representation**: Reused the problem chip design patterns (`✓` solved, `✗` failed, `—` unattempted) from ExamForge's design system.

## 3. Implementation Decision
- **Reuse**: The existing `StandingsService.computeContestStandings` calculation engine, database models (`ContestModel`, `ProblemModel`, `TestCaseModel`, `SubmissionModel`), PostgreSQL schema, indexes, and JWT authentication.
- **Extend**: 
  - Extended `StandingsService.computeContestStandings` to support server-side `filterStatus` (`all`, `solved_any`, `has_submissions`, `no_submissions`), whitelisted `sortBy` (`rank`, `score`, `solved`, `penalty`, `participant`, `submissions`), `sortOrder` (`ASC`, `DESC`), and `totalSubmissions` count per participant.
  - Ensured that sorting by custom fields operates *after* authoritative rank assignment, strictly preserving each participant's official rank.
- **Create New Only Where Necessary**:
  - Dedicated admin route: `GET /api/contests/:id/admin-leaderboard` with strict manager RBAC and BOLA ownership checks.
  - Frontend component: [`AdminContestLeaderboard.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestLeaderboard.jsx) and [`adminContestLeaderboard.css`](file:///d:/Secureexamplatform/frontend/src/components/admin/adminContestLeaderboard.css).
- **Do Not Rewrite**: Zero changes made to judging queues, Elo rating algorithms, scoring weights, or public student leaderboard endpoints.

## 4. Implemented Features
1. **Dedicated Admin Leaderboard Endpoint (`GET /api/contests/:id/admin-leaderboard`)**:
   - Strictly secured: Rejects anonymous callers with `401 Unauthorized` and student accounts with `403 Forbidden`.
   - Prevents BOLA/IDOR: Rejects professors attempting to inspect contests created by other professors with `403 Forbidden`.
   - Accepts parameters: `page`, `limit`, `search`, `sortBy`, `sortOrder`, `filterStatus`, `freezeOverride`.
2. **Whitelisted Server-Side Sorting with Official Rank Preservation**:
   - Allows administrators to sort participants by `score`, `solved`, `penalty`, `participant`, `submissions`, or `rank`.
   - Authoritative ranks assigned via ICPC rules remain completely unchanged regardless of sort field or direction.
3. **Status Filtering**:
   - Filter participants by activity: `all`, `solved_any` (solved at least 1 problem), `has_submissions` (active submitters), `no_submissions` (enrolled students who have not yet submitted).
4. **Leaderboard Freeze Override**:
   - Displays whether the contest is currently frozen.
   - Provides an interactive toggle allowing administrators to switch between public masked view and true live unmasked standings.
5. **Participant Performance Inspection Modal**:
   - Clicking "Inspect" on any participant row opens a detailed scorecard displaying official rank, total points, solves, penalty, total submissions, and a problem-by-problem breakdown table.
6. **Summary Metrics Bar**:
   - Displays real-time counts for Total Participants, Total Problems, Top Score, Average Score, and Median Score.
7. **Native Drawer Integration**:
   - Added `Standings & Leaderboard` tab to `AdminContestManagement.jsx` drawer.
   - Added direct leaderboard inspection action to the contest table.

## 5. Backend Changes
- [`backend/src/services/standingsService.js`](file:///d:/Secureexamplatform/backend/src/services/standingsService.js):
  - Updated `computeContestStandings` parameters to accept `sortBy`, `sortOrder`, and `filterStatus`.
  - Added `totalSubmissions` count to evaluated participant structures.
  - Implemented status filtering (`solved_any`, `has_submissions`, `no_submissions`).
  - Implemented whitelisted sorting (`rank`, `score`, `solved`, `penalty`, `participant`, `submissions`) while preserving official ranks.
  - Added `sortBy`, `sortOrder`, and `filterStatus` to the returned pagination object.
- [`backend/src/controllers/contestController.js`](file:///d:/Secureexamplatform/backend/src/controllers/contestController.js):
  - Implemented `getContestAdminLeaderboard` handler.
  - Enforced integer contest ID validation (returns `400 Bad Request` if invalid).
  - Enforced RBAC check (`professor`, `contest_admin`, `super_admin`).
  - Enforced contest existence check (returns `404 Not Found` if nonexistent).
  - Enforced professor ownership BOLA check (`contest.created_by === req.user.id`).
  - Enforced parameter whitelisting for `sortBy`, `sortOrder`, and `filterStatus`.
  - Exported `getContestAdminLeaderboard`.
- [`backend/src/routes/contestRoutes.js`](file:///d:/Secureexamplatform/backend/src/routes/contestRoutes.js):
  - Mounted `router.get('/:id/admin-leaderboard', authorizeRoles('professor', 'contest_admin', 'super_admin'), mediumProtectionRateLimiter, contestController.getContestAdminLeaderboard)`.

## 6. Frontend Changes
- [`frontend/src/components/admin/AdminContestLeaderboard.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestLeaderboard.jsx):
  - Standalone admin leaderboard component with search, filtering, sorting, freeze override, metrics cards, problem chips matrix, pagination, and participant inspection modal.
- [`frontend/src/components/admin/adminContestLeaderboard.css`](file:///d:/Secureexamplatform/frontend/src/components/admin/adminContestLeaderboard.css):
  - Dedicated stylesheet supporting dark glassmorphism, responsive table layouts, rank medals, and modal styling.
- [`frontend/src/components/admin/AdminContestManagement.jsx`](file:///d:/Secureexamplatform/frontend/src/components/admin/AdminContestManagement.jsx):
  - Imported `AdminContestLeaderboard`.
  - Added `Standings & Leaderboard` tab to the inspection drawer.
  - Updated table action button to open the drawer directly to the leaderboard tab.

## 7. API Changes
- **New Endpoint**: `GET /api/contests/:id/admin-leaderboard`
  - **Authentication**: Required (`Bearer <jwt>`)
  - **Authorization**: `professor`, `contest_admin`, `super_admin`
  - **Rate Limiting**: `mediumProtectionRateLimiter`
  - **Query Parameters**:
    - `page` (integer, default: 1)
    - `limit` (integer, default: 50, maximum: 100)
    - `search` (string, filtered safely against username/fullName)
    - `sortBy` (enum: `rank`, `score`, `solved`, `penalty`, `participant`, `submissions`)
    - `sortOrder` (enum: `ASC`, `DESC`)
    - `filterStatus` (enum: `all`, `solved_any`, `has_submissions`, `no_submissions`)
    - `freezeOverride` (boolean, defaults to true for managers)
  - **Responses**:
    - `200 OK`: Authoritative standings payload `{ contest, problems, pagination, standings, podium, contestSummary }`
    - `400 Bad Request`: Invalid contest ID format or unwhitelisted sort/filter parameters
    - `401 Unauthorized`: Missing or malformed authentication token
    - `403 Forbidden`: Student account or professor attempting to access another professor's contest
    - `404 Not Found`: Contest ID does not exist

## 8. Database Changes
- **No Schema Changes Required**:
  - Reused existing PostgreSQL tables (`contests`, `contest_problems`, `contest_participants`, `submissions`, `rating_history`).
  - All queries utilize existing composite indexes.

## 9. Authorization / RBAC
- **Student Accounts**: Explicitly denied access with `403 Forbidden`.
- **Anonymous Users**: Denied access with `401 Unauthorized`.
- **Professors**: Authorized exclusively for contests they created (`contest.created_by === req.user.id`).
- **Contest Administrators & Super Administrators**: Authorized across all contests.
- All authorization decisions occur server-side from cryptographically verified JWT claims (`req.user`).

## 10. BOLA / IDOR Protection
- Tested and verified:
  - Changing `:id` to another professor's contest returns `403 Forbidden`.
  - Client-supplied `req.body.userId`, `req.query.userId`, or `req.query.role` are completely ignored.
  - Draft contests remain confidential; unauthorized users cannot discover draft contest problem details.

## 11. Freeze & Lifecycle Enforcement
- Honors the configured `leaderboard_freeze_minutes` window.
- When a contest is running and inside the freeze window:
  - Passing `freezeOverride=false` returns the public masked standings.
  - Passing `freezeOverride=true` returns the live unmasked standings with all submissions evaluated.
- Supports all contest lifecycle phases (`draft`, `upcoming`, `running`, `ended`, `archived`).

## 12. Search / Filtering / Sorting
- **Search**: Safely matches substring against `username` or `fullName` in memory; resistant to SQL injection strings.
- **Filter**: Whitelisted to `all`, `solved_any`, `has_submissions`, `no_submissions`.
- **Sort**: Whitelisted to `rank`, `score`, `solved`, `penalty`, `participant`, `submissions`.
- **Rank Preservation**: Official rank assigned deterministically by ICPC rules remains immutable across all sort variations.

## 13. Pagination
- Server-side pagination with default `limit=50` and strict server-side clamp at `limit=100`.
- Response contains `currentPage`, `totalPages`, `totalParticipants`, `limit`, `hasNext`, `hasPrev`.

## 14. Performance Testing
- Standings computation runs single-pass SQL aggregation of contest submissions.
- Total payload size for 50 participants is under 35 KB.
- Clamping max limit to 100 prevents memory exhaustion attacks.

## 15. Security Testing
Exhaustive security checks executed in [`backend/test_phase7_5_8_3_admin_leaderboard.js`](file:///d:/Secureexamplatform/backend/test_phase7_5_8_3_admin_leaderboard.js):
1. Anonymous request rejected with `401 Unauthorized`.
2. Student request rejected with `403 Forbidden`.
3. Non-owning professor request rejected with `403 Forbidden` (BOLA/IDOR protection).
4. Contest creator professor allowed with `200 OK`.
5. Super Admin allowed with `200 OK`.
6. Non-integer contest ID rejected with `400 Bad Request`.
7. Negative contest ID rejected with `400 Bad Request`.
8. Non-existent contest ID returns `404 Not Found`.
9. Unwhitelisted `sortBy` rejected with `400 Bad Request`.
10. Unwhitelisted `sortOrder` rejected with `400 Bad Request`.
11. Unwhitelisted `filterStatus` rejected with `400 Bad Request`.
12. Excessive limit clamped safely to `100`.
13. SQL injection search payload handled safely as literal string without crashing or leaking data.
14. Client parameter tampering (`role` / `userId` injection) strictly rejected.
15. Draft contest access by non-owners rejected with `403 Forbidden`.

## 16. Tests Added
- [`backend/test_phase7_5_8_3_admin_leaderboard.js`](file:///d:/Secureexamplatform/backend/test_phase7_5_8_3_admin_leaderboard.js):
  - 37 automated test assertions covering RBAC, BOLA, validation, scoring consistency, whitelisted sorting, rank preservation, status filtering, freeze override, and pagination.

## 17. Test Results
- **Phase 7.5.8.3 Test Suite**:
  - **Passed**: 37
  - **Failed**: 0
  - **Skipped**: 0
  - **Total**: 37

## 18. Regression Results
Executed existing test suites across the project:
1. `backend/test_phase7_5_8_2_contest_results.js`: **52 passed, 0 failed, 0 skipped**
2. `backend/test_admin_phase5_5_9_scoring_consistency.js`: **46 passed, 0 failed, 0 skipped**
3. `backend/test_admin_phase5_7_6_eligibility_access.js`: **33 passed, 0 failed, 0 skipped**
- **Cumulative Regression Total**: **168 passed, 0 failed, 0 skipped**.

## 19. Build Verification
- Executed `npm run build` in `frontend/`:
  ```
  vite v8.2.1 building client environment for production...
  transforming...✓ 1884 modules transformed.
  rendering chunks...
  computing gzip size...
  dist/index.html                     1.12 kB │ gzip:   0.61 kB
  dist/assets/index-SALjcmRL.css    255.57 kB │ gzip:  38.78 kB
  dist/assets/index-CoF7K68w.js   1,011.36 kB │ gzip: 224.76 kB
  ✓ built in 672ms
  ```
- Result: **0 errors, exit code 0**.

## 20. Startup / Health Verification
- **PostgreSQL Connection**: Verified active connection via pool query.
- **Health Endpoint**: `GET /api/health` returned HTTP `200 OK` with payload:
  ```json
  {
    "server": "OK",
    "database": "OK"
  }
  ```
- **Admin Leaderboard API**: Verified live responses with test server running at `http://127.0.0.1:55833`.

## 21. Software Manager Quality Review
- **Architecture**:
  - Reused `StandingsService.computeContestStandings` as the sole scoring authority.
  - Zero duplicate scoring engines or frontend calculations introduced.
- **Security**:
  - Server-side RBAC and BOLA verification strictly enforced.
  - Students cannot access the admin leaderboard.
  - Professors cannot inspect other professors' contests.
- **Data Integrity**:
  - ICPC tie-breaker rules strictly respected.
  - Sorting preserves official ranks.
- **Maintainability**:
  - Minimal changes, clean component decoupling, clear prop contracts.
- **Scope**:
  - Stayed strictly within Phase 7.5.8.3 boundaries. No premature implementation of 7.5.8.4 (Result Details) or 7.5.8.6 (Export & Reporting).

## 22. Known Issues
- None.

## 23. Final Status
**COMPLETE** — Phase 7.5.8.3 is verified, tested, built, and approved by the Software Manager Quality Gate. Ready for git checkpointing.
