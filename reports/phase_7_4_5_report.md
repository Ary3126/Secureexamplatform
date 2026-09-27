# Phase 7.4.5 - Edit Problem: Completion Report

**Project**: ExamForge - Secure Examination Platform
**Phase**: 7.4.5 - Edit Problem (Full Workflow)
**Status**: COMPLETE
**Date**: 2026-09-27

---

## 1. Goal

Make the Edit Problem workflow fully functional using the Shared Problem Editor
created in Phase 7.4.3. Reuse all existing infrastructure: the AdminProblemEditor
component, PUT /api/problems/:id, updateProblemWithSafety, and canManageResource.

---

## 2. Existing Update Infrastructure Audited

| Component | Location | Status |
|-----------|----------|--------|
| Update Route | PUT /api/problems/:id | Exists, authenticate + authorizeRoles guard |
| Route RBAC | authorizeRoles(professor, contest_admin, super_admin) | Correct |
| Validation | validateUpdateProblem middleware | COALESCE-friendly, field-optional |
| Controller | problemController.updateProblem | Exists, uses canManageResource for BOLA |
| Model | ProblemModel.updateProblemWithSafety | Atomic TX, optimistic concurrency, review revocation |
| Model inner | ProblemModel.updateProblem | COALESCE-based, preserves unset fields |
| Load endpoint | GET /api/admin/problems/:id | Returns full problem + sampleTestCases |
| BOLA guard | canManageResource(user, problem.createdBy) | super_admin/contest_admin global; prof=own only |
| Frontend Editor | AdminProblemEditor mode=edit | Pre-existing in Phase 7.4.3, wires to PUT |
| Unsaved changes | dirty state + modal in editor | Pre-existing in Phase 7.4.3 |
| Concurrency | expectedVersion/version + 409 response | Pre-existing |

---

## 3. Findings & Classification

| Finding | Classification |
|---------|---------------|
| Editor sends testCases in PUT body but controller ignored them | MISSING (Gap) |
| updateProblemWithSafety did not replace sample test cases on update | MISSING (Gap) |
| Controller had no notFound guard for model returning { notFound: true } | BUG |
| Frontend: AdminProblemEditor Edit Mode populates from GET /api/admin/problems/:id | Implemented & Verified |
| BOLA: canManageResource correctly blocks professor-on-professor edits | Implemented & Verified |
| Dirty state tracking + unsaved changes modal | Implemented & Verified (Phase 7.4.3) |
| Optimistic concurrency (version mismatch -> 409) | Implemented & Verified |
| Data preservation: COALESCE in updateProblem preserves unset fields | Implemented & Verified |

---

## 4. Changes Made

### 4.1 backend/src/models/problemModel.js

Extended updateProblemWithSafety to support optional testCases replacement:
- Destructures testCases from updateData before passing to updateProblem
- If testCases is provided and non-empty:
  DELETE FROM test_cases WHERE problem_id=$1 AND is_hidden=false (preserves hidden judge TCs)
  INSERT new sample test cases within the same transaction
- Audit metadata now includes sampleTestCasesUpdated boolean flag

### 4.2 backend/src/controllers/problemController.js

- Added testCases to req.body destructuring
- Added testCases: Array.isArray(testCases) ? testCases : undefined to model call
- Added notFound guard (was missing - model can return { notFound: true })

---

## 5. Shared Editor Integration

The Shared AdminProblemEditor in Edit Mode was already correctly wired (Phase 7.4.3):

  Admin Panel -> Problems list -> Edit button -> navigateSubroute('edit', id)
    -> AdminProblemEditor mode="edit" problemId={id}
      -> useEffect: GET /api/admin/problems/:id
        -> Populate formData from response (title, description, difficulty,
           codingMode, accessScope, starterTemplates, harnessTemplates,
           sampleTestCases->examples, version)
          -> Admin edits fields
            -> handleSave() -> validateProblemForm(formData)
              -> PUT /api/problems/:id with full payload including testCases
                -> 200 OK or 409 Conflict
                  -> onSaved() -> refresh list -> navigate to list

No frontend changes were required.

---

## 6. Edit Workflow: Step-by-Step Verification

Step                         Result
-------------------------------------------------------
Load problem (GET /admin/problems/:id)    PASS (2.1-2.3)
Update title/description/difficulty       PASS (2.4-2.6)
Version incremented after update          PASS (2.7)
Review status reset to draft after update PASS (2.8)

---

## 7. Data Preservation Verification

Test: Change only difficulty (easy -> hard), send no title/description.
Result: COALESCE preserves existing title and description (5.2-5.3).
codingMode preserved (5.5).

COALESCE in updateProblem:
  title = COALESCE($1, title)           -- null -> keeps existing
  description = COALESCE($2, description)
  difficulty = COALESCE($3, difficulty)
  coding_mode = COALESCE($4, coding_mode)
  starter_templates = COALESCE($5, starter_templates)
  harness_templates = COALESCE($6, harness_templates)
  access_scope = COALESCE($7, access_scope)

---

## 8. Sample Test Cases Replacement

When admin edits the Examples section and saves:
- Old sample test cases are atomically deleted (is_hidden=false only)
- New sample test cases are inserted within the same transaction
- Hidden judge test cases are never touched

Test: Problem created with 2 sample TCs. Updated with 3 new ones.
Result: Problem correctly has 3 new TCs; old TCs gone (3.3-3.6).

---

## 9. Security Testing

| Test | Result |
|------|--------|
| Unauthenticated PUT returns 401 | PASS |
| Student role returns 403 | PASS |
| Professor cannot edit another professor problem (BOLA) | PASS |
| Super Admin can edit any problem | PASS |
| Contest Admin can edit any problem | PASS |
| Response does not expose password_hash | PASS |
| Response does not expose jwt_secret | PASS |
| PROBLEM_UPDATED audit event recorded | PASS |
| 403 response does not expose SQL | PASS |

---

## 10. Tests Added

backend/test_admin_phase4_5_edit_problem.js - NEW: 51 assertions across 8 sections

Section 1: RBAC & Authorization          (6+setup)
Section 2: Core Edit Workflow            (8+setup)
Section 3: Sample Test Cases Replacement (6+setup)
Section 4: Optimistic Concurrency        (4+setup)
Section 5: Data Preservation             (5+setup)
Section 6: Input Validation              (4+setup)
Section 7: Invalid ID & Not Found        (3)
Section 8: Security                      (8+setup)

---

## 11. Test Results

Phase 7.4.5 Edit Problem Integration     51/51 PASS
Phase 7.4.4 Create Problem Regression    46/46 PASS
Phase 7.4.3 Backend Regression           31/31 PASS
Phase 7.4.3 Frontend Regression          22/22 PASS
Frontend Production Build                OK (1.63s)
Backend Startup Verification             OK

---

## 12. API Changes

PUT /api/problems/:id
  - Now accepts optional testCases array in request body
  - testCases, if provided, atomically replaces sample test cases
  - Hidden test cases are never affected
  - No breaking change: if testCases is absent, behavior unchanged

---

## 13. DB Changes

None. Existing test_cases table is reused.
No schema migrations required.

---

## 14. Known Issues

None.

---

## 15. Remaining Phase 7.4 Work

Phase 7.4.6: Test Case Management (hidden test cases CRUD)
Phase 7.4.7: (to be defined)

---

## 16. Git Checkpoint

Commit: phase-7.4.5-edit-problem-complete
Files changed: 5 (2 new test files, 1 new report, 2 modified source files)

---

## 17. Final Status

Phase 7.4.5 is COMPLETE.

The Edit Problem workflow is fully functional end-to-end:
- Admin opens a problem in Edit Mode - existing values load into the 7-tab editor
- Admin modifies any field (title, description, difficulty, coding mode, templates, examples)
- Unsaved changes confirmation protects against accidental navigation
- Save submits PUT /api/problems/:id with full payload
- Server validates, checks RBAC, runs optimistic concurrency check
- Sample test cases are atomically replaced if editor examples were changed
- Hidden judge test cases are preserved
- Audit log records PROBLEM_UPDATED event
- 409 conflict on stale version; user sees clear message
- onSaved refreshes the problem list and navigates back

DO NOT start Phase 7.4.6 without explicit instruction.
