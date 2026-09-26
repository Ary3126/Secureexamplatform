# Phase 7.4.3 — Shared Problem Editor Report

## 1. Phase Information
- **Phase**: Phase 7 — Admin Panel V1 Re-Development
- **Sub-Phase**: 7.4.3 — Shared Problem Editor
- **Date**: September 26, 2026
- **Status**: COMPLETE & VERIFIED

---

## 2. Goal
Build the shared Problem Editor architecture that serves both **Create Problem** (`/admin/problems/new`) and **Edit Problem** (`/admin/problems/:id/edit`). Establish:
1. A unified state and form model supporting both Create Mode and Edit Mode without duplicating logic or components.
2. Structured authoring layout comprising the 7 core sections:
   - Basic Information (Title, Description, Difficulty, Tags, Constraints)
   - Examples & Test Cases (Input, Output, Explanation)
   - Coding Configuration (Standard OJ vs Function Mode)
   - Language Configuration (Multi-language starter templates)
   - Function Mode & DSL Configuration (Signature, return type, parameters, harness templates)
   - Test Case Section Foundation (Sample vs Hidden Test Cases boundary)
   - Execution Limits & Governance (Time limit, memory limit, output cap, versioning, review status)
3. Robust client-side validation mirroring server-authoritative validation rules.
4. Dirty state tracking and unsaved changes confirmation modal.
5. Optimistic concurrency conflict handling (`expectedVersion` / `version` mismatch -> HTTP 409).
6. Full architectural integration with `harnessBuilder.js` (`// __STUDENT_CODE__` placeholder) and the Docker evaluation pipeline.

---

## 3. Existing Architecture Audited
Prior to implementation, a complete report-first audit was conducted across existing database schemas, models, controllers, and services:
1. **Problem Database Schema (`backend/src/database/schema.sql`)**:
   - `problems`: `id SERIAL PRIMARY KEY`, `title VARCHAR(200)`, `description TEXT`, `difficulty VARCHAR(20)`, `coding_mode VARCHAR(30)`, `starter_templates JSONB`, `harness_templates JSONB`, `access_scope VARCHAR(30)`, `version INTEGER DEFAULT 1`, `is_published BOOLEAN`, `published_at TIMESTAMP`, `review_status VARCHAR(30) DEFAULT 'draft'`.
   - `test_cases`: `id SERIAL PRIMARY KEY`, `problem_id INTEGER REFERENCES problems(id)`, `input_data TEXT`, `expected_output TEXT`, `is_sample BOOLEAN`, `is_hidden BOOLEAN`, `time_limit_ms INTEGER`, `memory_limit_mb INTEGER`, `test_order INTEGER`.
2. **Backend API Endpoints**:
   - `POST /api/problems`: Creates a problem draft with atomic transaction support in `ProblemModel.createProblemWithSafety`.
   - `PUT /api/problems/:id`: Updates a problem with optimistic concurrency check (`expectedVersion`) and version incrementation.
   - `GET /api/admin/problems/:id`: Super Admin endpoint returning problem metadata and visible sample test cases (`sampleTestCases`).
   - `POST /api/admin/problems/:id/archive`: Super Admin archive transition.
3. **Execution Pipeline & Harness Builder (`backend/src/judge/harness/harnessBuilder.js`)**:
   - In Function Mode (`coding_mode: 'function'`), student submissions author only `class Solution` logic.
   - Platform replaces `// __STUDENT_CODE__` or `# __STUDENT_CODE__` inside `harness_templates[lang]` with the submitted student code.
   - In Standard OJ (`coding_mode: 'full_program'`), candidate code is compiled standalone without harness injection.
4. **Validation Rules (`backend/src/middleware/contestValidation.js`)**:
   - `title`: String, 3–200 characters.
   - `description`: String, min 5 characters.
   - `difficulty`: `'easy'`, `'medium'`, or `'hard'`.
   - `coding_mode`: `'full_program'` or `'function'`.
   - `access_scope`: `'public'`, `'contest_private'`, `'class'`, or `'institution'`.

---

## 4. Findings & Classification
- **Implemented and Verified**:
  - `ProblemModel.createProblemWithSafety`, `updateProblemWithSafety`, and `findProblemById` fully support dual coding modes and template storage.
  - `TestCaseModel.findVisibleSampleTestCases` accurately loads sample test cases without leaking hidden evaluation cases.
  - `adminNavConfig.js` subroute routing functions (`parseAdminProblemSubroute`, `buildAdminProblemPath`) accurately resolve list, create, and edit paths.
- **Missing / Gap Resolved in Phase 7.4.3**:
  - `ProblemModel.createProblemWithSafety` supported an optional `testCases` array, but `problemController.createProblem` did not destructure `testCases` from `req.body`. Added `testCases` destructuring so sample test cases authored during problem creation are atomically persisted.
  - `validateUpdateProblem` previously rejected payloads that updated only `codingMode`, `starterTemplates`, or `accessScope` without title/description changes. Extended validation to accept and validate these fields.
  - `AdminProblemEditor.jsx` was an initial tab shell; enhanced into a complete shared architecture with 7 reusable sections, form validation, dirty state tracking, unsaved change warnings, and optimistic concurrency collision alerts.
- **Code & Test Alignment**:
  - Extracted pure constants and validators to `adminProblemEditorConstants.js` so Node.js test runners and Vite can consume them without JSX compilation hurdles.

---

## 5. Shared Editor Architecture

### 5.1 Dual-Mode Operation
```
AdminProblemEditor (frontend/src/components/admin/AdminProblemEditor.jsx)
 ├── Create Mode (/admin/problems/new)
 │    ├── Clean default state model
 │    ├── Function Mode selected by default (medium difficulty, public scope)
 │    ├── Default starter code templates across C++, Python, Java, JS, C
 │    ├── Initial sample test case template
 │    └── Dispatches POST /api/problems
 └── Edit Mode (/admin/problems/:id/edit)
      ├── Validates numeric problemId upfront (rejects non-numeric slugs)
      ├── Loads existing record via GET /api/admin/problems/:id
      ├── Populates form fields & maps sampleTestCases to Examples section
      ├── Preserves version counter (v1, v2, ...) for optimistic locking
      ├── Tracks dirty state against loaded baseline
      └── Dispatches PUT /api/problems/:id with expectedVersion
```

### 5.2 The 7 Reusable Sections
1. **Basic Information**:
   - Title input with live character counter (3–200 chars).
   - Difficulty dropdown (`easy`, `medium`, `hard`) with color badges.
   - Access Scope dropdown (`public`, `contest_private`, `class`, `institution`).
   - Tags & Categories comma-separated input.
   - Multiline problem constraints editor (`1 <= N <= 10^5`, `-10^9 <= nums[i] <= 10^9`).
2. **Statement & Examples**:
   - Problem Statement textarea with Live Markdown Preview toggle.
   - Dynamic Examples manager: Add, edit, remove sample test cases with input stream, expected output, and explanation.
3. **Coding Architecture**:
   - Interactive selection cards between **Function Mode (Solution Class)** and **Standard OJ (Full Program)**.
   - Explanatory bullet points detailing I/O handling, stdin/stdout vs Solution class, and Docker sandboxing constraints.
4. **Languages & Starter Code**:
   - Multi-language tab selector (Python 3, C++ 17, Java 17, JavaScript, C).
   - Code textarea with syntax-friendly styling and line numbering support.
   - "Reset to Default Template" action button.
5. **Function Mode & DSL Configuration**:
   - Function Signature builder (Function Name, Return Type, Parameters).
   - "Auto-Generate Starter & Harness from Signature" helper button that populates C++, Python, and Java templates.
   - Harness template viewer/editor with clear `// __STUDENT_CODE__` placeholder callout.
6. **Test Case Section Foundation**:
   - Live metrics summary: Public Sample Test Cases vs Confidential Evaluation Cases.
   - Preview table showing input preview, expected output, and public sample status.
   - Clear architectural boundary note for Phase 7.4.4 test case management.
7. **Limits & Governance**:
   - CPU Time Limit input (500–10000 ms, default 2000 ms).
   - Memory Limit input (64–1024 MB, default 256 MB).
   - Output Buffer Cap indicator (512 KB sandbox limit).
   - Governance & Audit Snapshot: Review status badge, active version, concurrency enforcement status, and authoring role.

### 5.3 UX & Safety Controls
- **Unsaved Changes Indicator**: Live dirty-state badge appears whenever any form field diverges from the initial/loaded baseline.
- **Confirmation Modal**: Intercepts "Back" or "Cancel" clicks when dirty, preventing accidental work loss.
- **Optimistic Concurrency Detection**: If another user or tab modified the problem, server returns HTTP 409 and UI prompts the user to reload the latest version without overwriting.

---

## 6. Routes
- `/admin/problems` — Directory listing view.
- `/admin/problems/new` — Problem Editor in **Create Mode**.
- `/admin/problems/:id/edit` — Problem Editor in **Edit Mode**.
- Invalid problem IDs (e.g. `/admin/problems/invalid-slug/edit` or `/admin/problems/-1/edit`) trigger client-side validation immediately, rendering an accessible error card with a "Back to Problems" button without broken API calls.

---

## 7. Components & Modules Changed

| File | Change Summary |
|---|---|
| `frontend/src/components/admin/adminProblemEditorConstants.js` | Created pure JS module exporting supported languages, default templates, and form validation logic. |
| `frontend/src/components/admin/AdminProblemEditor.jsx` | Implemented complete Shared Problem Editor architecture with 7 reusable sections, dirty state tracking, and concurrency alerts. |
| `frontend/src/components/admin/adminProblemManagement.css` | Added styling for form controls, coding mode cards, tabs, code editors, preview toggles, and modal overlays. |
| `frontend/src/components/AdminPanel.jsx` | Connected `onSaved` callbacks in `ProblemsSection` to automatically refresh directory listings. |
| `backend/src/controllers/problemController.js` | Updated `createProblem` to accept and pass `testCases` to `createProblemWithSafety`. |
| `backend/src/middleware/contestValidation.js` | Extended `validateCreateProblem` and `validateUpdateProblem` to validate `codingMode` and `accessScope`. |
| `backend/package.json` | Added `test:phase7_4_3` script. |
| `frontend/package.json` | Added `test:phase7_4_3` script. |
| `frontend/scripts/testRunner.js` | Registered `admin_problem_editor` in `SUITE_DEFINITIONS`, `admin`, and `fast` categories. |
| `backend/test_admin_phase4_3_editor_integration.js` | Created backend integration test suite covering RBAC, create, edit, concurrency, validation, and HarnessBuilder. |
| `frontend/test_admin_phase4_3_editor_ui.js` | Created frontend unit & logic test suite covering defaults, validation, dirty tracking, templates, and routing. |

---

## 8. API Changes & Payload Enhancements
- `POST /api/problems`:
  - Now accepts optional `testCases: [{ inputData, expectedOutput, isSample, isHidden, timeLimitMs, memoryLimitMb, testOrder }]`.
  - Atomically creates problem and initial sample test cases in the same database transaction.
- `PUT /api/problems/:id`:
  - Accepts `title`, `description`, `difficulty`, `codingMode`, `starterTemplates`, `harnessTemplates`, `accessScope`, `version`, `expectedVersion`.
  - Enforces optimistic concurrency via `expectedVersion`. Returns HTTP 409 Conflict if outdated.

---

## 9. Database Changes
No new tables or schema migrations required. The existing PostgreSQL `problems` and `test_cases` schemas natively support all fields (`coding_mode`, `starter_templates`, `harness_templates`, `access_scope`, `version`, `review_status`).

---

## 10. Harness & Execution Pipeline Integration
Verified that `HarnessBuilder.buildExecutableCode` (`backend/src/judge/harness/harnessBuilder.js`):
1. In `full_program` mode: returns candidate source code unmodified.
2. In `function` mode: replaces `// __STUDENT_CODE__` or `# __STUDENT_CODE__` in `harness_templates[lang]` with the student's solution class.
3. Preserves entrypoint (`main()`) and includes without line-number collision.

---

## 11. Test Execution & Verification

### 11.1 Targeted Backend Integration Suite (`npm run test:phase7_4_3`)
- **Command**: `node test_admin_phase4_3_editor_integration.js`
- **Result**: 31 Passed, 0 Failed
- **Highlights**:
  - Unauthenticated requests return 401
  - Student requests return 403 Forbidden
  - Super Admin problem creation returns 201 Created with version 1
  - Sample test cases atomically inserted with problem
  - GET `/api/admin/problems/:id` returns metadata and sample test cases
  - PUT `/api/problems/:id` updates problem and increments version to 2
  - Optimistic concurrency conflict returns 409 Conflict with currentVersion
  - Validation catches short title, short description, invalid difficulty
  - Non-numeric ID returns 400 Bad Request; non-existent ID returns 404 Not Found
  - HarnessBuilder successfully compiles student code with stored harness template
  - Zero sensitive credentials leaked in responses

### 11.2 Targeted Frontend Suite (`npm run test:phase7_4_3`)
- **Command**: `node --test test_admin_phase4_3_editor_ui.js`
- **Result**: 22 Passed, 0 Failed (7 suites)
- **Highlights**:
  - Create Mode initializes with clean defaults
  - Edit Mode populates existing problem fields without data loss
  - Validation rules enforce title length, description length, valid difficulties, coding modes, access scopes, and resource limits
  - Function name syntax enforced in Function Mode
  - Starter templates provided for all 5 supported languages across both coding modes
  - Harness templates contain `__STUDENT_CODE__` placeholder
  - Dirty state detected across all fields
  - Route parsing and invalid ID detection verified

### 11.3 Admin Category Test Suite (`npm run test:admin`)
- **Command**: `node scripts/testRunner.js --category=admin`
- **Result**: 5/5 Suites Passed (0.47s total duration)
  1. `test_admin_phase1_shell.js` — 7/7 PASSED
  2. `test_admin_phase2_dashboard.js` — 7/7 PASSED
  3. `test_admin_phase3_users.js` — 10/10 PASSED
  4. `test_admin_phase4_1_problems_ui.js` — 14/14 PASSED
  5. `test_admin_phase4_3_editor_ui.js` — 22/22 PASSED

### 11.4 Backend Fast Regression Suite (`npm run test:fast`)
- **Command**: `npm run test:fast`
- **Result**: 21/21 Suites Passed (33.88s total duration)
- **Status**: Zero regressions across auth, contests, problem bank, submissions, metrics, distribution, audit logging, and platform reliability.

### 11.5 Full Frontend Test Suite (`npm test`)
- **Command**: `npm test`
- **Result**: 21/21 Suites Passed (21.41s total duration)
- **Status**: Zero regressions across all student, professor, and admin UI suites.

### 11.6 Frontend Production Build (`npm run build`)
- **Command**: `vite build`
- **Result**: Built successfully in 717ms with zero errors.

### 11.7 Backend Server Startup Verification
- **Command**: `node -e "const server = require('./src/server'); setTimeout(() => { process.exit(0); }, 1500);"`
- **Result**: Clean startup and graceful termination with code 0.

---

## 12. Security Verification
1. **Server-Side RBAC**: Problem authoring and updating are protected by `authorizeRoles('professor', 'contest_admin', 'super_admin')`. Administrative inspection is strictly restricted to `super_admin`.
2. **Optimistic Concurrency**: Simultaneous mutations with stale versions are blocked with HTTP 409 Conflict.
3. **Input Sanitization**: Length bounds and enum restrictions enforced on both frontend and backend.
4. **Credential Isolation**: Zero password hashes or security tokens exposed in responses or state models.

---

## 13. Deferred Functionality
Per the Phase 7 plan and explicit stop rule, the following are intentionally deferred:
- **Phase 7.4.4**: Complete Test Case Management & Batch Zip Upload Studio.
- **Later Phase**: Automated Oracle Code Verifier and Monaco Editor Advanced Code Completion.

---

## 14. Final Status
**PHASE 7.4.3 IS COMPLETE AND VERIFIED.**
All acceptance criteria have been satisfied and validated with comprehensive automated test suites.
