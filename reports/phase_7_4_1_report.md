# Phase 7.4.1 — General Problem Management Architecture Report

## 1. Phase Information
- **Phase**: Phase 7 — Admin Panel V1 Re-Development
- **Sub-Phase**: 7.4.1 — General Problem Management Architecture
- **Date**: September 26, 2026
- **Status**: COMPLETE & VERIFIED

---

## 2. Goal
Build strictly the architectural foundation for Admin Problem Management without implementing the full problem creation/editing forms or complete test-case management. Establish:
1. Canonical Admin Problem Management hierarchy:
   ```
   Admin
    └── Problems
         ├── Problem List (/admin/problems)
         ├── Add Problem (/admin/problems/new)
         └── Edit Problem (/admin/problems/:id/edit)
   ```
2. Shared Problem Editor architecture:
   ```
   ProblemEditor
    ├── Create Mode (/admin/problems/new)
    └── Edit Mode (/admin/problems/:id/edit)
   ```
3. Secure API integration boundaries with RBAC enforcement (`super_admin` only).
4. Full architectural alignment with existing coding modes (Standard OJ vs Function Mode), harness builder (`harnessBuilder.js`), online judge sandbox, test-case schema, and problem database schema.

---

## 3. Existing Architecture Audited
A report-first comparative audit of the codebase, documentation, database schema, and test suites was conducted prior to writing code:

1. **Problem Database Schema (`backend/src/database/schema.sql`)**:
   - `problems` table: `id SERIAL PRIMARY KEY`, `title`, `description`, `difficulty` ('easy','medium','hard'), `coding_mode` ('full_program','function'), `starter_templates JSONB`, `harness_templates JSONB`, `access_scope` ('public','contest_private','class','institution'), `version INTEGER DEFAULT 1`, `is_published BOOLEAN`, `review_status` ('draft','review_requested','in_review','changes_requested','rejected','approved','published','archived','withdrawn').
   - `test_cases` table: `id SERIAL PRIMARY KEY`, `problem_id INTEGER REFERENCES problems(id)`, `input_data TEXT`, `expected_output TEXT`, `is_hidden BOOLEAN`, `time_limit_ms INTEGER`, `memory_limit_mb INTEGER`, `test_order INTEGER`.
2. **Backend API & Route Structure**:
   - `backend/src/routes/adminRoutes.js`: Previously lacked direct `GET /api/admin/problems` and `GET /api/admin/problems/:id`. Only had `/problem-reviews` and user management routes.
   - `backend/src/controllers/adminController.js`: Contained overview stats and user management methods, but no general problem listing/detail handlers.
   - `backend/src/models/problemModel.js`: Contained `findAllProblems`, `countAllProblems`, and `findProblemById`. `findAllProblems` was missing `p.version`, `p.is_published`, `p.review_status` in its SELECT projection.
3. **Execution Pipeline & Coding Modes**:
   - **Standard OJ (`full_program`)**: Complete standalone programs reading from stdin and printing to stdout. No harness wrapping required.
   - **Function Mode (`function`)**: User submits only the solution function/class. Built dynamically at execution time via `harnessBuilder.js` (`backend/src/judge/harness/harnessBuilder.js`) for C++, Python, and Java.
4. **Current Admin Routing & Navigation**:
   - `frontend/src/config/adminNavConfig.js`: Exported `ADMIN_NAV_SECTIONS` including `problems: { path: '/admin/problems' }`. Lacked subroute parsing for `/admin/problems/new` and `/admin/problems/:id/edit`.
   - `frontend/src/components/AdminPanel.jsx`: Rendered `ProblemsSection` referencing an unimported legacy component `AdminProblemGovernance` and attempting to fetch `/api/admin/problems`.

---

## 4. Findings & Classification
- **Implemented and Verified**:
  - `ProblemModel.createProblem`, `findProblemById`, `findAllProblems`, and `countAllProblems` exist and handle RBAC scoping (`userRole: 'super_admin'`).
  - `TestCaseModel.findVisibleSampleTestCases` exists and safely isolates public sample test cases from hidden evaluation test cases.
  - `harnessBuilder.js` correctly builds multi-language harnesses for Function Mode without line numbering collision.
  - Admin shell authorization strictly restricts access to `super_admin` in `adminRoutes.js`.
- **Missing / Gap Resolved**:
  - `GET /api/admin/problems` was missing in `adminRoutes.js` and `adminController.js`. Implemented with pagination and multi-dimensional filtering.
  - `GET /api/admin/problems/:id` was missing. Implemented with sample test case inclusion and safe disclosure.
  - `POST /api/admin/problems/:id/archive` was missing from `adminRoutes.js`. Wired to `problemLifecycleController.archiveProblem`.
  - Subroute resolution helper for `/admin/problems/new` and `/admin/problems/:id/edit` was missing. Added `parseAdminProblemSubroute` and `buildAdminProblemPath`.
- **Code / Documentation Alignment**:
  - `p.version`, `p.is_published`, and `p.review_status` were in the PostgreSQL schema since Phase 4A/5.9.5, but were not exposed in `ProblemModel.findAllProblems`. Added to SELECT projection.
  - Cleanly decoupled and retired orphaned references to `AdminProblemGovernance`.

---

## 5. Architecture Implemented

### 5.1 Route Structure & URL Hierarchy
Established the canonical Admin Problem Management routing tree with dual synchronization (browser URL history pushState/popstate and shell state):
- `/admin/problems` — Problem List Shell (`subview: 'list'`)
- `/admin/problems/new` — Problem Editor in Create Mode (`subview: 'create'`)
- `/admin/problems/:id/edit` — Problem Editor in Edit Mode (`subview: 'edit'`, `problemId: :id`)

### 5.2 Component Architecture
1. **`AdminProblemManagement.jsx`** (`frontend/src/components/admin/AdminProblemManagement.jsx`):
   - Problem Bank directory shell with live search, multi-factor filtering (difficulty, coding mode, status, access scope), pagination controls, and status badges.
   - Action triggers: "Add Problem" navigates to `/admin/problems/new`; "Edit" button navigates to `/admin/problems/:id/edit`.
2. **`AdminProblemEditor.jsx`** (`frontend/src/components/admin/AdminProblemEditor.jsx`):
   - Shared architectural container supporting dual operational modes:
     - **Create Mode**: Provisions a new problem draft with defaults (Medium difficulty, Function mode, Public access, Version 1).
     - **Edit Mode**: Loads existing problem specifications by ID and displays active version, publication state, and review state.
   - Defines clear architectural tab boundaries:
     1. *Metadata & Scope*: Title, description, difficulty, access scope (Public vs Contest Private).
     2. *Coding Architecture*: Mode toggle between Standard OJ (`full_program`) and Function Mode (`function`).
     3. *Starter & Harness Templates*: Language tabs for C++, Python, and Java starter templates.
     4. *Test Case Boundary*: Test case overview placeholder outlining sample vs hidden test case management.
     5. *Lifecycle & Review*: Review status overview, version tracking, publication controls placeholder.
3. **`adminProblemManagement.css`** (`frontend/src/components/admin/adminProblemManagement.css`):
   - Premium design system matching dark theme palette, glassmorphic card styling, badge indicators, responsive grid, and interactive tab switches.
4. **`ProblemsSection` in `AdminPanel.jsx`**:
   - Manages state machine across `subview` ('list' | 'create' | 'edit'), selected problem ID, and URL history.
   - Listens to browser back/forward `popstate` events to preserve seamless history traversal.

---

## 6. Integration Audit & Boundaries

| Component / Subsystem | Integration Pattern & Architectural Boundary |
|---|---|
| **Problem APIs** | Admin endpoints `GET /api/admin/problems` and `GET /api/admin/problems/:id` provide full platform visibility across all scopes (`public`, `contest_private`) and review statuses (`draft`, `published`, `archived`). |
| **Test Case APIs** | `TestCaseModel.findVisibleSampleTestCases(problemId)` is used for previewing sample test cases. Hidden test case administration is isolated to Phase 7.4.3. |
| **Coding Modes** | Both `full_program` (Standard OJ) and `function` (Function Mode) are first-class architectural modes represented in data models, query filters, and UI badges. |
| **Harness Builder (`harnessBuilder.js`)** | The shared problem editor defines starter templates and harness template payloads in sync with the structure consumed by `harnessBuilder.buildFullCode(sourceCode, harnessTemplate, language)`. |
| **Judge Pipeline & Sandbox** | Standard OJ passes through Docker runner as-is. Function Mode merges user code with language-specific harness before dispatching to Docker container. |
| **Security & RBAC** | All administrative endpoints require `authenticate` + `authorizeRoles('super_admin')` + `mediumProtectionRateLimiter`. Students, professors, and contest admins are blocked with `403 Forbidden`. |

---

## 7. Components & Modules Changed

| File | Change Summary |
|---|---|
| `frontend/src/config/adminNavConfig.js` | Added `parseAdminProblemSubroute` and `buildAdminProblemPath` for subroute navigation. |
| `frontend/src/components/admin/adminProblemManagement.css` | Created responsive stylesheet for problem list and problem editor shells. |
| `frontend/src/components/admin/AdminProblemManagement.jsx` | Created problem list directory shell with filters, search, pagination, and navigation triggers. |
| `frontend/src/components/admin/AdminProblemEditor.jsx` | Created shared problem editor shell with Create/Edit mode separation and 5 tab boundaries. |
| `frontend/src/components/AdminPanel.jsx` | Wired `ProblemsSection` to manage subviews (`list`, `create`, `edit`), URL pushState/popstate, and live API fetching. |
| `backend/src/controllers/adminController.js` | Added `getProblems` and `getProblemById` methods with bounded pagination, filters, and safe disclosure. |
| `backend/src/routes/adminRoutes.js` | Registered `GET /api/admin/problems`, `GET /api/admin/problems/:id`, and `POST /api/admin/problems/:id/archive`. |
| `backend/src/models/problemModel.js` | Included `version`, `isPublished`, `publishedAt`, and `reviewStatus` in `findAllProblems` query projection. |
| `backend/package.json` | Added `test:phase7_4_1` test script. |
| `frontend/package.json` | Added `test:phase7_4_1` test script. |
| `frontend/scripts/testRunner.js` | Registered `admin_problems` suite in `SUITE_DEFINITIONS`, `admin`, and `fast` categories. |
| `backend/test_admin_phase4_1_problems_architecture.js` | Created backend automated test suite covering RBAC, listing, detail, archive, and schema compatibility. |
| `frontend/test_admin_phase4_1_problems_ui.js` | Created frontend automated test suite covering subroute parsing, payload unwrapping, badges, and modes. |

---

## 8. API Changes
- `GET /api/admin/problems`
  - Auth: `Bearer <token>` (Super Admin only)
  - Query Params: `search`, `difficulty`, `coding_mode`, `status`, `access_scope`, `page`, `limit`, `sortBy`
  - Response: `{ status: 'success', data: { problems: [...], pagination: { total, page, limit, totalPages, hasNextPage, hasPrevPage } }, problems: [...], total }`
- `GET /api/admin/problems/:id`
  - Auth: `Bearer <token>` (Super Admin only)
  - Response: `{ status: 'success', data: { problem: { ...problemData, sampleTestCases: [...] } } }`
- `POST /api/admin/problems/:id/archive`
  - Auth: `Bearer <token>` (Super Admin only)
  - Behavior: Verifies contest attachments; transitions problem status to `archived` with audit logging.

---

## 9. Database Changes
No new tables or schema migrations were required. The existing `problems` and `test_cases` tables natively support all fields (`coding_mode`, `starter_templates`, `harness_templates`, `access_scope`, `version`, `review_status`).

---

## 10. Test Execution & Verification

### 10.1 Targeted Backend Suite (`npm run test:phase7_4_1`)
- **Assertions**: 30 Passed, 0 Failed
- **Highlights**:
  - Unauthenticated access returns `401 Unauthorized`
  - Student, Professor, and Contest Admin access returns `403 Forbidden`
  - Super Admin receives `200 OK` with paginated problem list
  - Filtering by difficulty, coding mode, and search term verified
  - Detail endpoint `/api/admin/problems/:id` returns sample test cases and validates ID format
  - Archive endpoint `/api/admin/problems/:id/archive` enforces RBAC
  - Function Mode starter/harness templates verified
  - Zero sensitive credentials leaked in response payloads

### 10.2 Targeted Frontend Suite (`npm run test:phase7_4_1`)
- **Assertions**: 14 Passed, 0 Failed
- **Highlights**:
  - Subroute parser correctly resolves `/admin/problems`, `/admin/problems/new`, and `/admin/problems/:id/edit`
  - URL builder produces valid paths for list, create, and edit modes
  - Enveloped and legacy payload structures unwrap cleanly
  - Difficulty, coding mode, and access scope badges map accurately
  - Pagination mathematics verified

### 10.3 Admin Category Test Suite (`npm run test:admin`)
- **Suites Executed**: 4/4 Passed (0.39s total duration)
  1. `test_admin_phase1_shell.js` — 7/7 PASSED
  2. `test_admin_phase2_dashboard.js` — 7/7 PASSED
  3. `test_admin_phase3_users.js` — 10/10 PASSED
  4. `test_admin_phase4_1_problems_ui.js` — 14/14 PASSED

### 10.4 Backend Fast Regression Suite (`npm run test:fast`)
- **Suites Executed**: 21/21 Passed (33.90s total duration)
- **Status**: Zero regressions across auth, contests, problem bank, submissions, metrics, percentiles, distribution, audit logging, and platform reliability.

### 10.5 Full Frontend Test Suite (`npm test`)
- **Suites Executed**: 20/20 Passed (21.58s total duration)
- **Status**: Zero regressions across auth, explorer, submissions, elo rating, identity profile, contest freeze, global leaderboard, progress UI, and admin modules.

### 10.6 Frontend Production Build (`npm run build`)
- **Command**: `node --max-old-space-size=4096 ./node_modules/vite/bin/vite.js build`
- **Result**: Built successfully in 817ms with zero errors.

### 10.7 Backend Server Startup Verification
- **Command**: `node -e "const server = require('./src/server'); setTimeout(() => { process.exit(0); }, 1500);"`
- **Result**: Verified clean startup and exit with code 0.

---

## 11. Security Testing
1. **Server-Side RBAC Enforcement**: Non-super_admin accounts receive HTTP `403 Forbidden` across all `/api/admin/problems/*` routes.
2. **Authentication Guard**: Unauthenticated requests receive HTTP `401 Unauthorized`.
3. **Direct URL & IDOR Defense**: Direct URL navigation to `/admin/problems/:id/edit` or API calls to `/api/admin/problems/:id` cannot be accessed by unauthorized roles. Non-existent IDs return 404, and non-numeric IDs return 400.
4. **Data Sanitization**: Responses are stripped of sensitive attributes; no password hashes, JWT secrets, or internal keys are exposed.
5. **Rate Limiting**: Protected with `mediumProtectionRateLimiter` against brute-force inspection.

---

## 12. Known Issues
- None. All components, routes, and tests operate cleanly without warnings or defects.

---

## 13. Remaining Work for Phase 7.4
- **Phase 7.4.2**: Complete Add/Edit Problem form implementation (Monaco editor for starter templates, full validation rules, form submission, and review workflow hooks).
- **Phase 7.4.3**: Complete Test-Case Management implementation (sample vs hidden cases, limits configuration, bulk I/O upload, and test runner verification).

---

## 14. Final Status
**PHASE 7.4.1 IS MARKED COMPLETE.**
Per the stop rule, Phase 7.4.2 will NOT be started until explicit user instruction.
