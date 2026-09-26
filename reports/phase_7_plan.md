# Phase 7 — Admin Panel V1 Plan

**Platform:** ExamForge (Secure Competitive Programming & Examination Platform)
**Phase:** Phase 7 — Admin Panel V1 Re-Development
**Stage:** PLANNING ONLY — Implementation NOT Started
**Prepared:** September 2026

---

## 1. Objective

Phase 7 will **rebuild and fully verify** the Admin Panel V1 of ExamForge as a clean, maintainable, secure, responsive, and functional administrative console.

The Admin Panel is the **Platform Governor Console** — the control center for `super_admin` users to manage users, problems, contests, review queues, audit security, and monitor system health.

### Scope Boundaries

| In Scope | Out of Scope |
|---|---|
| Admin Panel V1 (all 7 sections) | Student Panel redesign |
| Fixing bugs in the current Admin UI | Professor Panel development |
| Cleaning up duplicate/orphaned admin components | Secure Examination module |
| Verifying all existing Admin APIs work correctly | New non-admin features |
| New Admin APIs only where provably insufficient | Phase 8 or beyond |

---

## 2. Reports Reviewed

| Report | Location | Status |
|---|---|---|
| Phase 1 (Backend Foundation) | `report/phase_1_report.md` | Reviewed |
| Phase 2 (Auth & RBAC) | `report/phase_2_report.md` | Reviewed |
| Phase 3 (Contests & Problems) | `report/phase_3_report.md` | Reviewed |
| Phase 4 (Online Judge) | `report/phase_4_report.md` | Reviewed |
| Phase 4A / 4A Extra | `report/phase_4a_report.md`, `report/phase_4a_extra_report.md` | Reviewed |
| Phase 5 (Frontend Platform) | `report/phase_5_report.md` | Reviewed |
| Phase 6 (Stabilization) | `report/phase_6_report.md`, `reports/phase_6_report.md` | Reviewed |

### Historical Context Summary

- **Phase 1**: Express server, PostgreSQL, Helmet, `x-request-id`, `/api/health`.
- **Phase 2**: Users table, bcryptjs hashing, 24h JWT, `authorizeRoles`, `/api/users/me`.
- **Phase 3**: `contests`, `problems`, `contest_problems`, `contest_participants`, lifecycle engine.
- **Phase 4**: Multi-language judge sandbox (Python/C++/Java), `harnessBuilder.js`, Docker runner, anti-cheat.
- **Phase 5**: React 19 + Vite frontend, Monaco editor, dashboard, submissions, leaderboards, Coder Identity, skills taxonomy, audit logging, admin authoring studio, problem review governance, system health observability.
- **Phase 6**: Platform stabilized; 21 backend + 12 frontend suites passing. Three bugs fixed. Admin Panel partially implemented in Phase 5 sub-phases but was never a dedicated development target.

---

## 3. Current Architecture

```
EXAMFORGE PLATFORM
──────────────────────────────────────────────────────────────────────
FRONTEND (React 19 + Vite 8.2, Vanilla CSS, No Tailwind)
  App.jsx — Single-page view router (URL-based pushState navigation)
    Student AppShell  |  Admin Shell (AdminPanel)
                           AdminSidebar + AdminHeader + section router

BACKEND (Node.js / Express 4.19, CommonJS)
  /api — 48 REST endpoints
  Middleware stack: authenticate → authorizeRoles → mediumRateLimiter
  Admin Routes: /api/admin/* (super_admin only)

DATABASE (PostgreSQL 14+)
  17 tables in schema.sql + system_incidents (defined in initDb.js)

JUDGE SANDBOX
  JudgeQueue → HarnessBuilder → ProcessSandboxRunner / DockerRunner
```

### Admin Panel Architecture (Current)

```
super_admin navigates to /admin/*
        ↓
App.jsx — if activeView==='admin' && role==='super_admin' → render AdminPanel
        ↓
AdminPanel.jsx  (master shell, frontend/src/components/AdminPanel.jsx)
        ↓
AdminSidebar.jsx ── AdminHeader.jsx ── <main> section router
        ↓
Dashboard | Users | Problems | Contests | Reviews | System
(AdminAuditLogs.jsx is built but NOT wired here)
```

### Frontend Route Mapping

| URL Path | Admin Section | Component |
|---|---|---|
| `/admin` | dashboard | `AdminDashboard.jsx` |
| `/admin/users` | users | `AdminUserManagement.jsx` |
| `/admin/problems` | problems | `AdminProblemGovernance.jsx` |
| `/admin/contests` | contests | `AdminContestManagement.jsx` |
| `/admin/reviews` | reviews | `AdminReviewGovernance.jsx` |
| `/admin/system` | system | `AdminObservability.jsx` |
| `/admin/audit` | **audit** | `AdminAuditLogs.jsx` **(not wired yet)** |

---

## 4. Current Admin Implementation Status

### A. Access Guard — ✅ Working
- `App.jsx` lines 699–711 and 912–955
- Only renders AdminPanel if `currentUser.role === 'super_admin'`
- Non-admin: styled "Access Denied" screen
- Unauthenticated: "Authentication Required" + Login button
- During auth check: spinner

### B. Layout Shell — ✅ Working
- `AdminPanel.jsx` — master shell, 6 sections wired
- `AdminSidebar.jsx` — collapsible, mobile drawer, Ctrl+B shortcut
- `AdminHeader.jsx` — section title, hamburger
- `adminShell.css` + `adminDashboard.css` — complete dark-mode styles
- `adminNavConfig.js` — 6 nav items

### C. Dashboard — ✅ Working
- `AdminDashboard.jsx` — fetches `/api/admin/overview-stats`, renders all widgets
- `AdminDashboardView.jsx` — **ORPHANED duplicate** (never used)

### D. User Management — ✅ Working (1 bug in container)
- `AdminUserManagement.jsx` — pagination, filter, search, modals — correct
- ⚠️ **Bug P1** in `AdminPanel.jsx#handleToggleUserStatus`: sends `{ status: 'active'/'suspended' }` but backend expects `{ isActive: boolean }` → **status toggle always fails with 400**

### E. Problem Bank Governance — ❌ Broken
- `AdminProblemGovernance.jsx` — UI complete and correct
- ❌ **Bug P2**: container fetches `/api/admin/problems` → **endpoint does NOT exist** → 404
- ❌ **Bug P3**: container calls `/api/admin/problems/:id/archive` → **endpoint does NOT exist**
- Problem section **always empty / silently fails**

### F. Contest Management — ✅ Mostly Working
- Uses `/api/contests` (✅) and `/api/contests/:id/publish` (✅)
- ⚠️ Uses `PATCH /api/contests/:id { status:'archived' }` → **super_admin auth unverified**

### G. Review Governance — ✅ Working
- All 3 APIs exist and are connected

### H. System Observability — ✅ Working
- All 4 APIs exist and are connected; auto-refresh works

### I. Audit Logs — ❌ Not Wired
- `AdminAuditLogs.jsx` — **fully built component**
- ❌ **Gap G1/G2**: Not connected in `AdminPanel.jsx`; no nav entry in `adminNavConfig.js`
- Backend `/api/admin/audit-logs` — ✅ fully implemented

### J. Dead Code
- `AdminDashboardView.jsx` — duplicate, never used
- `AdminSystemHealth.jsx` — duplicate, never used
- `admin/placeholders/*.jsx` (×6) — never rendered

---

## 5. Existing Admin Files

### Frontend

| File | Type | Status |
|---|---|---|
| `src/components/AdminPanel.jsx` | Shell | Active (P1 bug) |
| `src/components/admin/AdminDashboard.jsx` | Section | ✅ Active |
| `src/components/admin/AdminDashboardView.jsx` | Section | ❌ Orphaned |
| `src/components/admin/AdminUserManagement.jsx` | Section | ✅ Active |
| `src/components/admin/AdminProblemGovernance.jsx` | Section | Active (broken) |
| `src/components/admin/AdminContestManagement.jsx` | Section | ✅ Active |
| `src/components/admin/AdminReviewGovernance.jsx` | Section | ✅ Active |
| `src/components/admin/AdminObservability.jsx` | Section | ✅ Active |
| `src/components/admin/AdminAuditLogs.jsx` | Section | ❌ Orphaned |
| `src/components/admin/AdminSystemHealth.jsx` | Section | ❌ Orphaned |
| `src/components/admin/AdminSidebar.jsx` | Layout | ✅ Active |
| `src/components/admin/AdminHeader.jsx` | Layout | ✅ Active |
| `src/components/admin/adminShell.css` | Styles | ✅ Active |
| `src/components/admin/adminDashboard.css` | Styles | ✅ Active |
| `src/components/admin/placeholders/*.jsx` (×6) | Placeholder | ❌ Unused |
| `src/config/adminNavConfig.js` | Config | ✅ Active (needs 7th entry) |

### Backend

| File | Type | Status |
|---|---|---|
| `src/routes/adminRoutes.js` | Routes | ✅ Active |
| `src/controllers/adminController.js` | Controller | ✅ Active |
| `src/controllers/adminSystemController.js` | Controller | ✅ Active |
| `src/models/userModel.js` | Model | ✅ Shared |
| `src/models/auditLogModel.js` | Model | ✅ Shared |
| `src/models/incidentModel.js` | Model | ✅ Active |
| `src/services/auditLogger.js` | Service | ✅ Shared |
| `src/services/systemHealthService.js` | Service | ✅ Shared |
| `src/services/metricsService.js` | Service | ✅ Shared |
| `src/middleware/authMiddleware.js` | Middleware | ✅ Shared |
| `src/middleware/roleMiddleware.js` | Middleware | ✅ Shared |
| `src/middleware/rateLimitMiddleware.js` | Middleware | ✅ Shared |
| `src/controllers/problemReviewController.js` | Controller | ✅ Shared |
| `src/controllers/problemQualityController.js` | Controller | ✅ Shared |

---

## 6. Existing Admin APIs

All `/api/admin/*` routes enforce: **JWT auth + `super_admin` role + medium rate limiting**

| Method | Endpoint | Purpose | Status |
|---|---|---|---|
| GET | `/api/admin/overview-stats` | Dashboard metrics | ✅ Working |
| GET | `/api/admin/audit-logs` | Paginated audit logs | ✅ Working |
| GET | `/api/admin/users` | Paginated user list | ✅ Working |
| GET | `/api/admin/users/:id` | Single user | ✅ Working |
| POST | `/api/admin/users` | Create user | ✅ Working |
| PUT | `/api/admin/users/:id` | Update profile | ✅ Working |
| PATCH | `/api/admin/users/:id/role` | Change role | ✅ Working |
| PATCH | `/api/admin/users/:id/status` | Toggle isActive | ✅ Working |
| GET | `/api/admin/problem-reviews` | Review queue | ✅ Working |
| GET | `/api/admin/problem-reviews/:id` | Review detail | ✅ Working |
| GET | `/api/admin/problem-review-analytics` | Review analytics | ✅ Working |
| GET | `/api/admin/reviewer-analytics` | Reviewer stats | ✅ Working |
| GET | `/api/admin/system/health` | System health | ✅ Working |
| GET | `/api/admin/system/metrics` | API metrics | ✅ Working |
| GET | `/api/admin/system/incidents` | Incidents log | ✅ Working |
| PATCH | `/api/admin/system/incidents/:id/status` | Update incident | ✅ Working |
| GET | `/api/admin/problems` | Admin problem listing | ❌ **MISSING** |
| POST | `/api/admin/problems/:id/archive` | Archive problem | ❌ **MISSING** |

### Other Endpoints Used by Admin Panel

| Method | Endpoint | Status |
|---|---|---|
| GET | `/api/contests` | ✅ Working |
| POST | `/api/contests/:id/publish` | ✅ Working |
| PATCH | `/api/contests/:id` (archive) | ⚠️ Auth unverified |

---

## 7. Database Dependencies

| Table | Admin Operations | API Support |
|---|---|---|
| `users` | READ, CREATE, UPDATE role/status/profile | ✅ Full |
| `contests` | READ, UPDATE status (publish/archive) | ✅ Via /api/contests/* |
| `problems` | READ all statuses (admin scope) | ❌ Missing admin endpoint |
| `problem_versions` | READ via review | ✅ Via review APIs |
| `problem_reviews` | READ queue + detail | ✅ Full |
| `problem_review_comments` | READ via review detail | ✅ Full |
| `problem_quality_snapshots` | READ via analytics | ✅ Full |
| `submissions` | READ aggregate stats | ✅ Via overview-stats |
| `audit_logs` | READ paginated + filtered | ✅ Full |
| `system_incidents` | READ paginated, UPDATE status | ✅ Full |
| `contest_participants` | READ count (overview-stats) | ✅ Full |

> `system_incidents` defined in `initDb.js` not `schema.sql` — known documentation gap; no Phase 7 action required.

---

## 8. Reuse Analysis

| Module | Status | Decision | Action |
|---|---|---|---|
| `AdminPanel.jsx` | Active, bugs | **B — Modify** | Fix P1; add audit section; fix problem endpoint |
| `AdminSidebar.jsx` | Working | **A — Reuse as-is** | None |
| `AdminHeader.jsx` | Working | **A — Reuse as-is** | None |
| `adminShell.css` | Working | **A — Reuse as-is** | None |
| `adminDashboard.css` | Working | **A — Reuse as-is** | None |
| `adminNavConfig.js` | 6 items | **B — Modify** | Add `audit` as 7th item |
| `AdminDashboard.jsx` | Working | **A — Reuse as-is** | None |
| `AdminDashboardView.jsx` | Orphaned | **E — Remove** | Delete |
| `AdminUserManagement.jsx` | Working | **A — Reuse as-is** | Fix applied in container |
| `AdminProblemGovernance.jsx` | Broken API | **B — Modify** | Update endpoint + server-side pagination |
| `AdminContestManagement.jsx` | Mostly working | **B — Verify** | Confirm super_admin contest auth |
| `AdminReviewGovernance.jsx` | Working | **A — Reuse as-is** | None |
| `AdminObservability.jsx` | Working | **A — Reuse as-is** | None |
| `AdminAuditLogs.jsx` | Orphaned | **B — Modify** | Wire to `audit` section |
| `AdminSystemHealth.jsx` | Orphaned | **E — Remove** | Delete |
| `admin/placeholders/*.jsx` (×6) | Unused | **E — Remove** | Delete 6 files |
| `authMiddleware.js` | Working | **A — Reuse as-is** | None |
| `roleMiddleware.js` | Working | **A — Reuse as-is** | None |
| `adminController.js` | Working | **A — Reuse as-is** | Add 2 new methods |
| `adminSystemController.js` | Working | **A — Reuse as-is** | None |
| `auditLogModel.js` | Working | **A — Reuse as-is** | None |
| `systemHealthService.js` | Working | **A — Reuse as-is** | None |
| `metricsService.js` | Working | **A — Reuse as-is** | None |
| `App.jsx` admin routing | Working | **B — Modify** | Add `/admin/audit` |

---

## 9. Current Problems / Gaps

### Critical Bugs (Blocking Correct Functionality)

| # | File | Problem | Impact |
|---|---|---|---|
| **P1** | `AdminPanel.jsx#handleToggleUserStatus` | Sends `{ status:'active'/'suspended' }` — backend expects `{ isActive: boolean }` | Status toggle always 400 |
| **P2** | `AdminPanel.jsx#ProblemsSection` | Fetches `/api/admin/problems` — endpoint does not exist | Problem Bank always 404 |
| **P3** | `AdminPanel.jsx#ProblemsSection` | Calls `/api/admin/problems/:id/archive` — endpoint does not exist | Archive silently fails |

### Missing Wiring

| # | Problem | Impact |
|---|---|---|
| **G1** | `AdminAuditLogs.jsx` not in `AdminPanel.jsx` section routing | Audit Logs inaccessible |
| **G2** | No `audit` entry in `adminNavConfig.js` | Sidebar never shows Audit Logs |

### Dead Code

| # | Problem |
|---|---|
| **D1** | `AdminDashboardView.jsx` — duplicate never used |
| **D2** | `AdminSystemHealth.jsx` — duplicate never used |
| **D3** | `admin/placeholders/*.jsx` (×6) — dead code |

### Architecture Gaps

| # | Problem | Impact |
|---|---|---|
| **A1** | No `/api/admin/problems` — public `/api/problems` only returns published | Admin cannot view full problem bank |
| **A2** | No `/api/admin/problems/:id/archive` | Admin cannot archive problems |

---

## 10. Proposed Admin V1 Scope

### Core Deliverables

1. **Admin Dashboard** — already working; no changes
2. **User Management** — fix status bug P1; verify full CRUD flow
3. **Problem Bank Governance** — add A1 + A2 endpoints; wire component; server-side pagination
4. **Contest Management** — verify publish/archive authorization for super_admin
5. **Review Governance** — already working; no changes
6. **Audit Logs** — wire `AdminAuditLogs.jsx`; add `audit` nav item
7. **System Observability** — already working; no changes
8. **Dead Code Removal** — delete 9 dead files
9. **Testing** — full backend + frontend test suite; security coverage

### Not in V1 Scope

- Admin → Professor/authoring management
- Admin → Student performance tools
- Admin → Exam lockdown controls
- Admin → Bulk import/export, email, config editor
- Real-time WebSocket updates

---

## 11. Admin Navigation Structure

### Current (6 items)

```
Dashboard / Users / Problem Bank / Contests / Reviews / System
```

### Proposed V1 (7 items — add Audit Logs)

```
Admin Panel Sidebar
├── Dashboard        /admin              — Overview metrics, health snapshot
├── Users            /admin/users        — Full user directory, CRUD, role/status
├── Problem Bank     /admin/problems     — All problems, all statuses
├── Contests         /admin/contests     — All contests, publish/archive
├── Reviews          /admin/reviews      — Review queue, SLA, reviewer analytics
├── Audit Logs       /admin/audit        — Immutable security event stream  [NEW]
└── System           /admin/system       — Health, metrics, incidents
```

### Navigation Behavior (Verified)

- ✅ URL-synced via pushState
- ✅ Back/Forward restores section
- ✅ Sidebar collapses to icons (Ctrl+B)
- ✅ Mobile drawer overlay
- ✅ localStorage persistence for collapse state
- ✅ Role guard at App.jsx level

**Change needed:** Add `audit` to `ADMIN_NAV_ITEMS`, `ADMIN_SECTION_LABELS`, `parseAdminSection` in `adminNavConfig.js`. Add `/admin/audit` to `App.jsx` URL routing.

---

## 12. Dashboard Plan

The existing `/api/admin/overview-stats` API already returns all needed data:

| Metric | Source | Display |
|---|---|---|
| total_students / professors / admins | users by role | Stat cards |
| total_suspended | is_active=false | Sub-stat |
| total/active/upcoming contests | contests | Stat cards |
| total/published/draft/pending problems | problems | Stat cards |
| pending/in_review reviews | problem_reviews | Stat card |
| recentContests (max 6) | contests | Contest list |
| recentActivity (last 10) | audit_logs | Activity timeline |
| system.databaseStatus / judgeStatus | health check | Health indicators |
| system.uptimeSeconds / nodeVersion | process | System info |

**No new dashboard data required. Dashboard is complete.**

---

## 13. UI/UX Plan

### Admin Design Language (Preserved)

- Background: `#070a12`, Sidebar: `#0d121f`, Cards: `rgba(15,23,42,0.7)`
- Borders: `rgba(255,255,255,0.08)`
- Accents: amber `#fbbf24`, blue `#38bdf8`, green `#34d399`, red `#f87171`
- Typography: system-ui stack

### UI Goals

1. **Consistency** — same card/table/button patterns across all sections
2. **Information density** — compact, scannable tables with server-side pagination
3. **Feedback** — loading states, success/error on every action
4. **Responsiveness** — sidebar collapse on mobile; horizontal scroll on tables
5. **Accessibility** — ARIA labels, keyboard nav, `aria-current` on active items

### Current UI Quality

| Section | Quality | Issues |
|---|---|---|
| Dashboard | ✅ Good | None |
| Users | ✅ Good | Bug in container, not component |
| Problem Bank | ⚠️ Partial | UI correct; empty (missing API) |
| Contests | ✅ Good | Client-side pagination |
| Reviews | ✅ Good | SLA badges polished |
| Audit Logs | ✅ Good | Complete; just not wired |
| System | ✅ Good | Auto-refresh + incidents polished |

---

## 14. Security Plan

### Current Security Architecture (Verified)

1. **Authentication**: `authenticate` middleware on all `/api/admin/*` routes (Express router level)
2. **Authorization**: `authorizeRoles('super_admin')` on all `/api/admin/*` routes
3. **Rate Limiting**: `mediumProtectionRateLimiter` on all admin routes
4. **Frontend Guard**: `App.jsx` role check — UX only, NOT a security control
5. **Self-Lockout Protection**: Cannot demote/deactivate the last active `super_admin`
6. **Audit Logging**: All mutations logged to `audit_logs` via `AuditLogger.logAction`
7. **Credential Redaction**: `sanitizeUser()` strips `password_hash` from all responses
8. **Input Validation**: Inline validation in all admin controller methods
9. **BOLA Defense**: All user operations verify target exists before operating

### Risks To Fix in Phase 7

| # | Risk | Severity | Fix |
|---|---|---|---|
| **S1** | Status toggle wrong payload; no feedback to admin | Medium | Fix container payload to `{ isActive: boolean }` |
| **S2** | Problem archive silently fails | Low | Create missing endpoints |
| **S3** | Contest archive auth unverified for super_admin | Medium | Verify/patch `contestController.js` |
| **S4** | Frontend role check not a security control | Low (by design) | Document only |

### New API Security Requirements

Any new `/api/admin/problems*` endpoint must:
- Apply `authenticate → authorizeRoles('super_admin') → mediumProtectionRateLimiter`
- Archive action must write to `audit_logs`
- Response must NOT include `harness_templates`, `oracle_code`, or test case inputs

---

## 15. Testing Plan

Every sub-phase: `IMPLEMENT → TEST → FIX → RETEST → VERIFIED`

### Backend Test File: `backend/test_phase7_admin_panel.js`

| Group | Key Test Cases |
|---|---|
| Dashboard API | 200 + shape; unauth→401; student→403; professor→403 |
| User Management | Pagination; role/search filter; POST create; PUT update; PATCH role (valid, lockout); PATCH status (isActive:true/false, lockout) |
| New Problem API | GET returns ALL problems (draft/published/archived); filter; pagination; POST archive→200; unauth→401; student→403 |
| Contest Admin | super_admin can publish/archive any contest |
| Review Queue | GET queue; detail; analytics; reviewer analytics |
| Audit Logs | GET paginated; filter by action/outcome/actor; date range |
| System APIs | GET health; metrics; incidents; PATCH incident status |
| Security | student→403 (all 16 admin endpoints); professor→403; no token→401; invalid JWT→401; malformed input→400; non-existent user→404 |

### Frontend Test File: `frontend/test_phase7_admin_ui.js`

| Group | Key Test Cases |
|---|---|
| Shell & Nav | 7 nav items; sidebar collapse; active highlight; Audit Logs item present |
| Access Guard | Unauth→auth screen; student→denied; super_admin→AdminPanel |
| Dashboard | data-testid="admin-dashboard"; stat grid; activity timeline |
| Users | Role modal; create modal; isActive boolean in status toggle |
| Problem Bank | Uses `/api/admin/problems`; server-side pagination |
| Contests | Renders; correct endpoints |
| Reviews | SLA badges present |
| Audit Logs | Renders; wired to 'audit' section |
| System | AdminObservability; auto-refresh; incidents |
| Dead Code | AdminDashboardView, AdminSystemHealth, placeholders do not exist |

### Regression

- `npm run test:fast` backend — all 21 existing suites pass
- `npm run test:fast` frontend — all 12 existing suites pass

---

## 16. Sub-Phase Breakdown

### Phase 7.1 — Bug Fixes, Dead Code Removal, Audit Logs Wiring

**Changes:**
- Fix `AdminPanel.jsx` status toggle: `{ status }` → `{ isActive: boolean }`
- Add `audit` to `adminNavConfig.js` (NAV_ITEMS, SECTION_LABELS, parseAdminSection)
- Wire `AdminAuditLogs.jsx` into `AdminPanel.jsx` as `audit` section with fetch
- Add `/admin/audit` to `App.jsx` URL routing
- Delete 9 dead files

**APIs:** `/api/admin/audit-logs` (existing) | **DB:** None | **Tests:** Frontend

**Acceptance:**
- [ ] Status toggle sends `{ isActive: boolean }`
- [ ] Audit Logs accessible at `/admin/audit`
- [ ] 9 dead files deleted
- [ ] All existing tests still pass

---

### Phase 7.2 — Admin Problem Bank API

**New APIs:**
- `GET /api/admin/problems` — all problems, paginated, filtered
- `POST /api/admin/problems/:id/archive` — archive with audit log

**Changes:**
- Add `getAdminProblems()` and `archiveProblem()` to `adminController.js`
- Add routes to `adminRoutes.js`
- Update `AdminPanel.jsx#ProblemsSection` (correct URL + server-side pagination)

**DB:** None (existing `problems` table) | **Tests:** Backend security

**Acceptance:**
- [ ] GET returns all problems regardless of status
- [ ] POST archives with audit log entry
- [ ] AdminProblemGovernance displays real data
- [ ] Server-side pagination works
- [ ] student/professor → 403

---

### Phase 7.3 — Contest Management Verification

**Changes:**
- Inspect `contestController.js` for super_admin authorization on publish/archive
- Fix authorization if needed

**DB:** None | **Tests:** Backend

**Acceptance:**
- [ ] super_admin can publish any contest
- [ ] super_admin can archive any contest
- [ ] Non-admin → 403

---

### Phase 7.4 — Integration Testing & Regression

**Changes:**
- Create `backend/test_phase7_admin_panel.js`
- Create `frontend/test_phase7_admin_ui.js`
- Register in both testRunner.js files
- Add `npm run test:phase7` to both package.json
- Run `npm run test:fast` (both sides) + `npm run build`

**Acceptance:**
- [ ] All Phase 7 backend tests pass
- [ ] All Phase 7 frontend tests pass
- [ ] Zero regressions in 21 backend suites
- [ ] Zero regressions in 12+ frontend suites
- [ ] Vite build completes with 0 errors

---

### Phase 7.5 — Final Report

- Create `reports/phase_7_report.md`

---

## 17. Dependency Map

```
Phase 7.1 — Bug Fixes + Dead Code + Audit Logs Wiring
        ↓
Phase 7.2 — Admin Problem Bank API
        ↓        (Phase 7.3 can run in parallel)
Phase 7.3 — Contest Management Verification
        ↓
Phase 7.4 — Integration Testing & Regression
        ↓
Phase 7.5 — Final Report
```

**Order:** 7.1 → 7.2 → 7.3 → 7.4 → 7.5. Phase 7.3 is independent and can overlap 7.2.

---

## 18. API Changes Required

| Type | Endpoint | Description | Justification |
|---|---|---|---|
| **NEW** | `GET /api/admin/problems` | Admin-scope problem listing, all statuses | Does not exist; required by AdminProblemGovernance |
| **NEW** | `POST /api/admin/problems/:id/archive` | Archive problem with audit log | Does not exist; Admin needs to deprecate problems |
| **VERIFY** | `PATCH /api/contests/:id` | Confirm super_admin can archive any contest | Auth unverified |
| **VERIFY** | `POST /api/contests/:id/publish` | Confirm super_admin can publish any contest | Auth unverified |

### `GET /api/admin/problems` Specification

```
Auth:    Bearer token, super_admin role required
Query:   page (default:1), limit (default:25 max:100),
         reviewStatus ('draft'|'review_requested'|'in_review'|'approved'|'published'|'archived'|'all'),
         difficulty ('easy'|'medium'|'hard'|'all'),
         accessScope ('public'|'contest_private'|'all'),
         isPublished ('true'|'false'|'all'),
         search (string, matches title/description),
         createdBy (integer)
Response:
  { status, data: { problems:[...], pagination:{total,page,limit,totalPages} } }
Fields returned (whitelisted):
  id, title, difficulty, coding_mode, access_scope, is_published, review_status,
  version, created_by, creator_username, created_at, updated_at
EXCLUDED: harness_templates, oracle_code, test case data
```

### `POST /api/admin/problems/:id/archive` Specification

```
Auth:    Bearer token, super_admin role required
Body:    none (action implied by route)
Effect:  SET review_status='archived', is_published=false
Audit:   action='PROBLEM_ARCHIVED', resourceType='problem', resourceId=id
Response: { status:'success', message:'Problem archived', data:{problem:{id,review_status}} }
Errors:  404 if problem not found
         409 if problem assigned to a currently running contest
```

---

## 19. Database Changes Required

**No new tables or columns are required.**

- `GET /api/admin/problems` — reads `problems` + JOIN `users` (creator_username). No schema changes.
- `POST /api/admin/problems/:id/archive` — UPDATEs existing `review_status` and `is_published` columns. Both exist with correct types and constraints.
- Existing indexes `idx_problems_review_status` and `idx_problems_is_published` will be used.

---

## 20. Performance Considerations

| Area | Risk | Mitigation |
|---|---|---|
| `/api/admin/overview-stats` | 6 parallel queries + judge health | Already measured; judge cached 60s |
| `/api/admin/users` | Table scan | Existing indexes; pagination enforced |
| `/api/admin/audit-logs` | Grows unbounded | `idx_audit_logs_created_at DESC`; max 100/page |
| `/api/admin/problems` (new) | Scans all problems | Use existing `idx_problems_review_status` + `idx_problems_is_published` |
| `AdminProblemGovernance` | Currently loads all client-side | Switch to server-side pagination |
| `AdminContestManagement` | Client-side filtering | Add server-side pagination when needed |

**Rule:** All admin list endpoints enforce server-side pagination (max 100/request).

---

## 21. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Contest archive PATCH not authorized for super_admin | Medium | Medium | Verify/fix in Phase 7.3 |
| R2 | New problem API exposes harness templates or oracle code | Low | High | Whitelist response fields strictly |
| R3 | Placeholder deletion breaks an import | Low | Low | Grep for imports before deletion |
| R4 | AdminDashboardView removal breaks a hidden import | Low | Low | Grep before deletion |
| R5 | Status fix regresses Phase 6 test assertions | Low | Medium | Re-run test:phase6 after fix |
| R6 | Test data collision with Phase 6 seeded users | Low | Low | Use phase-specific unique test prefixes |
| R7 | system_incidents in initDb.js confusion | Low | Low | Document; confirm initDb creates table on startup |

---

## 22. Acceptance Criteria

| # | Criterion | Verified By |
|---|---|---|
| AC1 | Bug P1 fixed: status toggle sends `{ isActive: boolean }` | Backend test |
| AC2 | Bug P2 fixed: `GET /api/admin/problems` exists and returns data | Backend test |
| AC3 | Bug P3 fixed: `POST /api/admin/problems/:id/archive` exists | Backend test |
| AC4 | Audit Logs section wired and accessible at `/admin/audit` | Frontend test |
| AC5 | 9 dead files deleted | File system check |
| AC6 | Contest publish/archive verified for super_admin | Backend test |
| AC7 | All 7 admin nav sections accessible and functional | Frontend test |
| AC8 | Frontend guard correctly blocks non-super_admin | Frontend test |
| AC9 | Backend returns 403 for student/professor on all admin endpoints | Backend security test |
| AC10 | JWT-less requests return 401 on all admin endpoints | Backend security test |
| AC11 | Malformed inputs return 400 (not 500) | Backend test |
| AC12 | All Phase 7 backend tests pass | `npm run test:phase7` |
| AC13 | All Phase 7 frontend tests pass | `npm run test:phase7` |
| AC14 | Zero regressions in 21 existing backend suites | `npm run test:fast` |
| AC15 | Zero regressions in existing frontend suites | `npm run test:fast` |
| AC16 | Frontend build completes with 0 errors | `npm run build` |
| AC17 | Backend starts cleanly; health check returns 200 | `GET /api/health` |
| AC18 | `reports/phase_7_report.md` created | File system check |

---

## 23. Implementation Order

```
Step 1: Phase 7.1 — Bug Fixes & Dead Code Removal
  1a. Fix AdminPanel.jsx status toggle (isActive: boolean)
  1b. Add 'audit' to adminNavConfig.js
  1c. Wire AdminAuditLogs.jsx into AdminPanel.jsx (fetch + section routing)
  1d. Add /admin/audit to App.jsx URL routing
  1e. Delete 9 dead files
  1f. npm run test:fast — confirm 0 regressions

Step 2: Phase 7.2 — Admin Problem Bank API
  2a. Add getAdminProblems() to adminController.js
  2b. Add archiveProblem() to adminController.js
  2c. Add GET /problems and POST /problems/:id/archive to adminRoutes.js
  2d. Update AdminPanel.jsx ProblemsSection (correct URL + pagination)
  2e. Write backend tests for new endpoints
  2f. Run tests — all pass

Step 3: Phase 7.3 — Contest Management Verification
  3a. Inspect contestController.js for super_admin authorization
  3b. Patch if needed
  3c. Write backend tests
  3d. Run tests

Step 4: Phase 7.4 — Integration Testing & Regression
  4a. Create backend/test_phase7_admin_panel.js
  4b. Create frontend/test_phase7_admin_ui.js
  4c. Register in both testRunner.js files
  4d. Add npm run test:phase7 to both package.json
  4e. npm run test:fast (backend) — 22 suites pass
  4f. npm run test:fast (frontend) — 13 suites pass
  4g. npm run build — 0 errors

Step 5: Phase 7.5 — Final Report
  5a. Create reports/phase_7_report.md
```

---

## 24. Out-of-Scope Items

| Item | Reason |
|---|---|
| Professor Panel development | Phase 8 scope |
| Secure Examination module | Future phase |
| Student Panel redesign | Do not touch |
| Admin bulk import/export | Not in V1 |
| Admin email notifications | Not in backend |
| Admin platform configuration editor | Not in V1 |
| Admin problem creation | Professor Studio scope |
| Admin judge queue monitoring | Covered by System section |
| Admin rating manipulation | Requires careful future design |
| Admin contest creation | Professor scope |
| Admin database backup/restore | Infrastructure level |
| Real-time WebSocket dashboard | Polling sufficient for V1 |
| Dark/light theme in Admin | Admin is permanently dark-mode |
| Multi-tenant institution-scoped admin | Not in ExamForge V1 architecture |

---

## Appendix: File Change Summary

### Files to Modify

- `frontend/src/components/AdminPanel.jsx` — P1 fix, audit section, problem endpoint fix
- `frontend/src/config/adminNavConfig.js` — add audit nav item
- `frontend/src/App.jsx` — add /admin/audit routing
- `backend/src/controllers/adminController.js` — 2 new methods
- `backend/src/routes/adminRoutes.js` — 2 new problem routes
- `backend/scripts/testRunner.js` — register phase7 suite
- `frontend/scripts/testRunner.js` — register phase7_ui suite
- `backend/package.json` — add test:phase7
- `frontend/package.json` — add test:phase7

### Files to Create

- `backend/test_phase7_admin_panel.js`
- `frontend/test_phase7_admin_ui.js`
- `reports/phase_7_report.md` (at Phase 7.5 completion)

### Files to Delete (9 total)

- `frontend/src/components/admin/AdminDashboardView.jsx`
- `frontend/src/components/admin/AdminSystemHealth.jsx`
- `frontend/src/components/admin/placeholders/DashboardPlaceholder.jsx`
- `frontend/src/components/admin/placeholders/UsersPlaceholder.jsx`
- `frontend/src/components/admin/placeholders/ProblemsPlaceholder.jsx`
- `frontend/src/components/admin/placeholders/ContestsPlaceholder.jsx`
- `frontend/src/components/admin/placeholders/ReviewsPlaceholder.jsx`
- `frontend/src/components/admin/placeholders/SystemPlaceholder.jsx`

**Summary: 9 files deleted · ~9 files modified · 2 test files + 1 report created**

---

*Phase 7 Planning Complete. STOP HERE. Wait for explicit instruction to begin implementation.*
