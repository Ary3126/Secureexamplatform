# Phase 7.4.9 Engineering Report: Preview / Draft / Publish

**Phase**: 7.4.9 — PREVIEW / DRAFT / PUBLISH  
**Status**: COMPLETE  
**Repository**: `Secureexamplatform`  
**Git Checkpoint**: `phase-7.4.9-preview-draft-publish-complete`  
**Date**: September 27, 2026  

---

## 1. Executive Summary & Goal
The objective of Phase 7.4.9 was to integrate the existing Shared Problem Editor (`AdminProblemEditor.jsx`) with the complete authoritative problem lifecycle:
```
Draft → Save → Preview → Validate → Publish → Published
```
The implementation directly reuses existing infrastructure (`ProblemModel.publishProblemWithSafety`, `ProblemModel.findProblemVersions`, `TestCaseModel.findVisibleSampleTestCases`, `AuditLogger`, optimistic concurrency version control) without introducing redundant preview engines, publishing subsystems, or version tables. Authoritative backend validation and strict RBAC defend against test case leakage, BOLA/IDOR, and concurrent overwrite collisions.

---

## 2. Existing Lifecycle Architecture Audited
Prior to implementation, an exhaustive audit was performed across database schemas, models, controllers, and frontend state:
1. **Status Architecture**:
   - `problems.is_published` (`BOOLEAN`): authoritative indicator of platform catalog publication.
   - `problems.review_status` (`VARCHAR(32)`): tracks lifecycle state (`'draft'`, `'in_review'`, `'approved'`, `'published'`).
   - `problems.version` (`INT`): monotonic revision counter enforced with optimistic concurrency.
2. **Draft Model**:
   - When a problem is authored or modified in the editor, `is_published` remains `false` and `review_status` is `'draft'`.
   - Normal Save operations (`PUT /api/problems/:id` or `POST /api/problems`) save authored state without publishing.
   - Editing an already published problem automatically increments the version number and resets `is_published = false` and `review_status = 'draft'`, preserving the previously published immutable snapshot in `problem_versions`.
3. **Preview Architecture**:
   - Backend endpoint `GET /api/problems/:id/preview` strictly verifies resource management permissions (`canManageResource`).
   - Visible sample test cases are fetched using `TestCaseModel.findVisibleSampleTestCases(id)` which enforces `is_hidden = false`.
   - Private harness code, judge secrets, and hidden test inputs/outputs are never returned.
4. **Publish Architecture**:
   - Backend endpoint `POST /api/problems/:id/publish` executes `ProblemModel.publishProblemWithSafety(id, actor, req)`.
   - Validates title, description, difficulty, codingMode, starterTemplates, harnessTemplates, and test cases under row lock (`SELECT ... FOR UPDATE`).
   - Requires at least one test case and at least one visible sample test case.
   - In Function Mode, verifies starter and harness templates for supported languages.
   - Transitions state to `is_published = true, review_status = 'published', access_scope = 'public'` in an atomic transaction.
   - Records an immutable snapshot in `problem_versions`.
5. **Optimistic Concurrency**:
   - Enforced via `expectedVersion` checking against `problems.version`.
   - Collisions return HTTP 409 Conflict with `currentVersion`, triggering interactive reload in the UI without silent overwrites.

---

## 3. Implementation Details

### A. Frontend Problem Editor Integration (`AdminProblemEditor.jsx`)
1. **Header & Lifecycle Badges**:
   - Added publication status badge (`Published` vs `Draft` with lock/check icons) alongside mode and version badges.
   - Added interactive `[Preview]` button (Eye icon).
   - Added `[Versions]` button (History icon) for edit mode.
   - Updated save button text: `Save Draft` / `Create Problem`.
   - Added primary `[Publish]` button (`.btn-publish`, UploadCloud icon).
2. **Preview Modal**:
   - Simulates student view with problem statement, constraints, visible sample test cases, and starter code syntax blocks.
   - Language selector dropdown dynamically previews starter code across allowed languages.
   - Zero hidden test cases or judge harness secrets are exposed.
3. **Publish Validation & Error Handling (HTTP 422)**:
   - Client-side pre-validation via `validateForPublish(formData)`.
   - If validation fails (client or backend 422), displays the `Publish Validation Failed` modal listing each error.
   - Each error item contains a `Fix in {Tab} →` button mapping the error message directly to the relevant editor tab via `getTabForPublishError(errorMsg)` and activating it.
4. **Publish Success Dialog**:
   - Confirms publication to student catalog with version number and timestamp.
   - Offers navigation back to problem directory or continuing work in the editor.
5. **Optimistic Concurrency Conflict Dialog (HTTP 409)**:
   - Detects version collisions between local form state and server.
   - Displays server version vs local version with `[Reload Latest Problem]` action without silent overwriting.
6. **Version History Modal**:
   - Fetches historical snapshots from `GET /api/problems/:id/versions`.
   - Displays immutable publication timeline with version numbers, timestamps, and change summaries.

### B. Helper Constants & CSS
1. **`adminProblemEditorConstants.js`**:
   - `validateForPublish(formData)`: client-side pre-validation checking title, description, difficulty, codingMode, starter templates, harness templates, and sample test case existence.
   - `getTabForPublishError(errorMsg)`: maps validation errors to target editor tabs (`'basic'`, `'examples'`, `'coding_mode'`, `'languages'`, `'function_dsl'`, `'test_cases'`, `'execution'`).
2. **`adminProblemManagement.css`**:
   - Styled status badges (`.editor-status-badge.draft`, `.editor-status-badge.published`).
   - Styled `.btn-publish` with distinct gradient and hover elevation.
   - Implemented dialog layouts: preview modal, publish errors modal, jump-to-tab buttons, conflict modal, and version history modal.

### C. Backend Security & Model Hardening
1. **Draft Access Protection (`ProblemModel.isUserAuthorizedForProblem`)**:
   - Hardened authorization check: when `isPublished === false`, public access is disallowed. Only `super_admin`, `contest_admin`, or the problem creator can view draft problems.
2. **Strict Test Case Visibility Filter (`TestCaseModel.findTestCasesByProblemId`)**:
   - Hardened `!includeHidden` filter to strictly require `is_hidden = false`.
3. **Admin Publishing Gate (`ProblemModel.publishProblemWithSafety`)**:
   - Added administrator direct publishing check allowing platform super admins and contest admins to publish directly while preserving review approval requirements for professors.
   - Returned `function_config` and `allowed_languages` in the publish returning clause.
4. **Creation Default Safety (`ProblemModel.createProblem`, `createProblemWithSafety`)**:
   - Explicitly supported `isPublished` parameter, defaulting to draft when specified by authoring interfaces.

---

## 4. API & Database Surface

### Database Schema (Zero New Tables)
- Reused `problems` table: `is_published`, `review_status`, `version`, `published_at`, `function_config`, `allowed_languages`.
- Reused `problem_versions` table: immutable publication snapshots (`version_number`, `test_cases_snapshot`, `starter_templates`, `harness_templates`, `function_config`, `allowed_languages`, `source_action`).
- Reused `test_cases` table: `is_hidden`, `is_sample`.
- Reused `audit_logs` table: `PROBLEM_PUBLISHED`, `PROBLEM_VERSION_CREATED`, `PROBLEM_UPDATED`.

### API Endpoints
| Endpoint | Method | Role | Purpose |
|---|---|---|---|
| `/api/problems/:id/preview` | `GET` | Creator / Admin | Returns student-style problem view with strictly visible sample test cases only |
| `/api/problems/:id/publish` | `POST` | Creator / Admin | Validates safety gate, records snapshot, sets published status (200 / 422) |
| `/api/problems/:id/versions` | `GET` | Creator / Admin | Lists historical immutable publication snapshots |
| `/api/problems/:id/versions/:v` | `GET` | Creator / Admin | Returns detailed snapshot for specific version |
| `/api/problems/:id` | `PUT` | Creator / Admin | Updates problem draft, enforces optimistic concurrency (409 on stale version) |
| `/api/problems/:id` | `GET` | Authenticated | Public view for students (only accessible when `isPublished = true`) |

---

## 5. Security & Invariant Verification
1. **Hidden Test Protection**:
   - Verified that `GET /api/problems/:id/preview` NEVER exposes hidden test case inputs (`"10 20"`), expected outputs (`"30"`), or private test entries.
   - Verified that public student view `GET /api/problems/:id` contains only visible sample test cases.
   - Verified that administrative `/api/problems/:id/test-cases` returns 403 Forbidden for students.
2. **Draft & Private Problem Isolation**:
   - Verified that students cannot view unpublished draft problems (`403` / `404`).
   - Verified that unauthenticated users cannot preview or publish problems (`401`).
3. **BOLA / IDOR Defense**:
   - Verified that a professor cannot preview, update, or publish problems owned by another professor (`403 Forbidden`).
   - Verified that contest admins and super admins can manage and publish any problem.
4. **Optimistic Concurrency & Silent Overwrite Defense**:
   - Verified that submitting updates with a stale version returns HTTP 409 Conflict with `currentVersion`.
   - Verified that database state is NOT overwritten during version collisions.

---

## 6. Test Suites & Verification Results

### A. Frontend Unit Test Suite (`frontend/test_admin_phase4_9_preview_publish_ui.js`)
- **Total Tests**: 25
- **Passed**: 25
- **Failed**: 0
- **Coverage**:
  - Publication validation gate: title, description, difficulty, codingMode, functionName, starter templates, harness templates, test cases, and sample test case existence.
  - Error-to-tab navigation mapping: basic, examples, coding_mode, languages, function_dsl, test_cases, execution, fallback.
  - Student preview generation & zero hidden-test leakage defense.
  - Draft and published state transitions.
  - Stale version concurrency conflict detection.

### B. Backend Integration Test Suite (`backend/test_admin_phase4_9_preview_publish.js`)
- **Total Tests**: 64
- **Passed**: 64
- **Failed**: 0
- **Coverage**:
  - Section 1: Draft lifecycle (create, save, edit, reload, student access block).
  - Section 2: Preview system (admin preview, zero hidden-test leakage, zero harness leakage, RBAC, BOLA defense).
  - Section 3: Publication validation gate (missing test cases, missing harness, 422 responses, unpublished persistence).
  - Section 4: Publish workflow & immutable version snapshots in `problem_versions`.
  - Section 5: Optimistic concurrency defense (HTTP 409 Conflict, no silent overwrites).
  - Section 6: Republish / edit published problem lifecycle (reverts to draft, version increment, re-publication).
  - Section 7: Version history endpoints & RBAC (versions list, version detail, student 403, 404 on invalid version).
  - Section 8: Student access after publication & zero hidden-test leakage.

### C. Full Regression Test Verification
| Test Suite | Scope | Result |
|---|---|---|
| `backend/test_admin_phase4_9_preview_publish.js` | Phase 7.4.9 Lifecycle | **64 passed, 0 failed** |
| `frontend/test_admin_phase4_9_preview_publish_ui.js` | Phase 7.4.9 Frontend | **25 passed, 0 failed** |
| `backend/test_admin_phase4_8_language_dsl.js` | Phase 7.4.8 Languages & DSL | **60 passed, 0 failed** |
| `frontend/test_admin_phase4_8_language_dsl_ui.js` | Phase 7.4.8 Frontend | **22 passed, 0 failed** |
| `backend/test_admin_phase4_7_coding_mode.js` | Phase 7.4.7 Coding Mode | **56 passed, 0 failed** |
| `frontend/test_admin_phase4_7_coding_mode_ui.js` | Phase 7.4.7 Frontend | **13 passed, 0 failed** |
| `backend/test_admin_phase4_6_test_cases.js` | Phase 7.4.6 Test Cases | **72 passed, 0 failed** |
| `frontend/test_admin_phase4_6_test_cases_ui.js` | Phase 7.4.6 Frontend | **18 passed, 0 failed** |
| `backend/test_admin_phase4_5_edit_problem.js` | Phase 7.4.5 Edit Problem | **51 passed, 0 failed** |
| `backend/test_admin_phase4_4_create_problem.js` | Phase 7.4.4 Create Problem | **46 passed, 0 failed** |
| `frontend/test_admin_phase4_3_editor_ui.js` | Phase 7.4.3 Editor UI | **22 passed, 0 failed** |
| `frontend npm run build` (Vite) | Production Compilation | **Exit 0 (2.15s)** |

---

## 7. Known Issues & Non-Regressions
- None. All test suites pass cleanly with 0 failures, 0 regressions, and clean tear-down of ephemeral test data.

---

## 8. Remaining Phase 7.4 Work
- **Phase 7.4.10**: Shared Problem Editor Review & Integration Signoff (Audit, cleanup, and complete integration verification).

---

## 9. Final Status
**PHASE 7.4.9 IS FULLY COMPLETE.**  
All acceptance criteria are satisfied, audited, and verified against the live PostgreSQL database and production build. Per the STOP RULE, Phase 7.4.10 has NOT been started.
