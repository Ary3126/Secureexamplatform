# Phase 5 Master Report — Modern Frontend Architecture, Problem Discovery, Coding Analytics, Competitive Rating & Coder Identity System

## Executive Summary

Phase 5 delivers an end-to-end modern, high-performance web and competitive programming experience for the **Secure Competitive Programming & Examination Platform**:
* **Phase 5.1:** Public Landing Page, Authentication UX (Signup/Login), Theme Engine (Light/Dark/System), and Monaco Editor theme synchronization.
* **Phase 5.2:** Student Dashboard, Problem Discovery & Explorer, Bookmarks/Saved Problems, Server-Side Filtering, Debounced Search, Sorting, and URL State Persistence.
* **Phase 5.3:** Submission History (`/submissions`), Coding Analytics Engine, Personal CSV Export, Source Code Viewer Modal, and "Reopen in Editor" workflow.
* **Phase 5.4:** Competitive Programming Rating System, Multi-Participant Elo Engine ($K=64$ provisional, $K=32$ rated), Idempotent Transactional Finalization, SVG Rating Progression Graph, Rating History, and Global Rank.
* **Coder Identity Profile Redesign (Master Task):** Complete digital Coder Identity system featuring deterministic "Code Core" dynamic SVG emblem, Rating Core, Coding DNA performance snapshot, Difficulty Orbit segmented arc ring, Topic Constellation domain mastery network, public/private route isolation (`/u/:username`, `/profile`), and profile modal editing.

All statistics, unique solved challenge deduplication (`COUNT(DISTINCT problem_id)` where `status = 'accepted'`), performance metrics, rating points conservation, and activity timelines are computed directly against PostgreSQL records.

---

## 1. Phase 5 System Architecture

```
                          ┌────────────────────────────────────────────────────────┐
                          │                   Client Browser                       │
                          │   (React 19 + Monaco Editor + Lucide + Vanilla CSS)    │
                          └──────────────────────────┬─────────────────────────────┘
                                                     │
         ┌───────────────────┬───────────────────────┼──────────────────────┬───────────────────────┐
         │                   │                       │                      │                       │
  ┌──────▼──────┐     ┌──────▼──────┐         ┌──────▼──────┐        ┌──────▼──────┐         ┌──────▼──────┐
  │ LandingPage │     │  Auth UX    │         │   Problem   │        │   Student   │         │    Coder    │
  │  & Showcase │     │ Login/Signup│         │  Explorer   │        │  Dashboard  │         │   Identity  │
  └─────────────┘     └─────────────┘         └──────┬──────┘        └──────┬──────┘         └──────┬──────┘
                                                     │                      │                       │
                                ┌────────────────────┴──────────────────────┴───────────────────────┘
                                │ REST API (JWT Authenticated / Public Safe)
                                ▼
                  ┌───────────────────────────┐
                  │   Express.js Controller   │
                  │    & Service Layer        │
                  └─────────────┬─────────────┘
                                │
         ┌──────────────────────┼───────────────────────┬───────────────────────┐
         ▼                      ▼                       ▼                       ▼
  ┌──────────────┐       ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
  │ problemModel │       │  userModel   │        │ savedProblem │        │ submission   │
  └──────┬───────┘       └──────┬───────┘        └──────┬───────┘        └──────┬───────┘
         │                      │                       │                       │
         │                      ▼                       │                       ▼
         │               ┌──────────────┐               │                ┌──────────────┐
         │               │ ratingModel  │               │                │ ratingService│
         │               └──────┬───────┘               │                └──────┬───────┘
         │                      │                       │                       │
         └──────────────────────┴───────────────────────┴───────────────────────┘
                                │
                                ▼
                  ┌───────────────────────────┐
                  │    PostgreSQL Database    │
                  │ (problems, submissions,   │
                  │ rating_history, contests) │
                  └───────────────────────────┘
```

---

## 2. Phase 5.1 & 5.2 Implementation Highlights

* **Theme Engine:** Instant flash-free theme loader with `light`, `dark`, and `system` modes synchronized dynamically with the Monaco Editor.
* **Public Showcase & Auth:** Hero code snippet preview, platform metrics, password strength analyzer, and secure JWT authentication.
* **Problem Explorer (`/problems`):** 300ms debounced search across title/description/ID, multi-select filters (Difficulty, Mode, Status, Bookmarks), server-side pagination, and URL parameter synchronization with browser history.
* **Student Dashboard (`/dashboard`):** Real-time metrics, "Continue Practicing" challenge resumption, bookmarked challenges widget, running/upcoming contests, and competitive rating pill.

---

## 3. Phase 5.3 Implementation Highlights

### 3.1 Submissions History & Server-Side Filtering (`/submissions`)
* **Endpoint (`GET /api/submissions/my`):**
  * `search`: Debounced search matching problem title or problem ID.
  * `verdict`: Filters by judge verdict (`accepted`, `wrong_answer`, `time_limit_exceeded`, `compilation_error`, `runtime_error`).
  * `language`: Filters by language (`cpp`, `python`, `java`).
  * `timeRange`: Filters by date window (`today`, `7d`, `30d`, `all`).
  * `sortBy`: Server-side ordering by `newest`, `oldest`, `runtime_asc`, `memory_asc`, `score_desc`.
  * `page` & `limit`: Server-side pagination with metadata (`currentPage`, `totalPages`, `totalSubmissions`, `hasNext`, `hasPrev`).
* **Table / Card Columns:** `# ID`, `Problem Title`, `Language`, `Verdict Badge`, `Score`, `Runtime (ms)`, `Memory (MB)`, `Submitted At`, and `[ View Code ]` action.

### 3.2 Coding Analytics Engine (`GET /api/submissions/analytics`)
* **Accurate Metric Calculations:**
  * **Acceptance Rate:** `ROUND((accepted / total) * 100, 1)` with zero-division safety.
  * **Unique Problems Solved:** Strictly uses `COUNT(DISTINCT problem_id)` where `status = 'accepted'` (deduplicates multiple accepted runs on the same problem into 1 solved problem).
  * **Performance Metrics:** Average execution time (`ms`), Average memory used (`MB`), Best runtime, and Best memory.

---

## 4. Phase 5.4 — Competitive Rating System Highlights

### 4.1 Rating Algorithm & Elo Engine
* **Initial State:** All new users start with rating `1200`, `rating_status = 'provisional'`, `rated_contest_count = 0`, and `highest_rating = 1200`.
* **Provisional Calibration vs. Established Rated Status:**
  * Threshold: $N = 5$ rated contests.
  * Provisional K-factor: $K = 64$ (faster convergence during early calibration).
  * Rated K-factor: $K = 32$ (stable rating movements for established competitors).
  * Transition is strictly automatic upon the 5th finalized rated contest.
* **Multi-Participant Pairwise Elo Algorithm:**
  $$\Delta R_i = \text{round}\left( \frac{K_i}{N - 1} \sum_{j \neq i} (A_{ij} - E_{ij}) \right)$$
* **Point Conservation:** Conserved approximately to zero sum ($\sum \Delta R \approx 0$).

---

## 5. Master Task — Coder Identity Profile Redesign

### 5.1 Deterministic "Code Core" Dynamic SVG Emblem (`CoderEmblem.jsx`)
* **Vector-Driven Visual Identity:** Generates unique geometric circuit paths, bracket nodes, inner energy core, and outer tier orbit ring based on rating, tier, solve count, and username hash.
* **Zero External Dependencies:** 100% pure responsive vector SVG (no external avatar services).
* **Tier-Responsive Palette:** Adapts to all rating tiers (Grandmaster: Crimson, Master: Amber, Expert: Violet, Specialist: Cyan, Competitor: Azure, Newbie: Slate).

### 5.2 Unified Coder Identity Aggregation API (`GET /api/users/:idOrUsername/identity`)
* Combines user metadata, competitive rating, rank, performance metrics, difficulty breakdown, algorithmic topic constellation, contest history, and recent activity into a single optimized query.
* **Strict Privacy Isolation:** When visited by other students or unauthenticated users (`/u/:username` or `/profile/:id`), private fields (email, password hash, security metadata) are strictly omitted while public performance data is displayed.

### 5.3 Visual Domain Intelligence Components
* **Difficulty Orbit (`DifficultyOrbit.jsx`):** Segmented circular arc ring showing Easy (Green), Medium (Amber), and Hard (Rose) unique solved problems with percentage breakdown pills and central count callout.
* **Topic Constellation (`TopicConstellation.jsx`):** Interactive SVG network graph displaying algorithmic domain strength (Arrays, Strings, Trees, Graphs, DP, Searching, Math, Stacks/Queues, Sorting) with glowing interconnecting edges and hover tooltips.

### 5.4 Contest Journey & Interactive Progression Graph
* Responsive SVG line chart with area gradient fill, horizontal gridlines, and interactive hover tooltips (Contest Title, Rank, Delta, New Rating).
* Tabulated Contest History log with color-coded $+\Delta$ (emerald) and $-\Delta$ (rose) delta pills.

---

## 6. Comprehensive Automated Test Verification

### Summary Table

| Test Suite | Total Tests | Passed | Failed | Success Rate |
|---|---|---|---|---|
| **Phase 5.1 (Landing, Auth UX, Theme System)** | 22 | 22 | 0 | 100% |
| **Phase 5.2 (Dashboard, Explorer, Bookmarks)** | 24 | 24 | 0 | 100% |
| **Phase 5.3 (Submissions, Analytics, CSV Export)** | 26 | 26 | 0 | 100% |
| **Phase 5.4 (Competitive Rating & Elo Engine)** | 43 | 43 | 0 | 100% |
| **Coder Identity Profile (Redesign & Isolation)** | 35 | 35 | 0 | 100% |
| **Phase 5.5 (Contest Leaderboard & Live Standings)** | 36 | 36 | 0 | 100% |
| **Phase 5.6 (Global & College Leaderboard)** | 55 | 55 | 0 | 100% |
| **Phase 2 (Auth, Profile, RBAC Backend)** | 35 | 35 | 0 | 100% |
| **Phase 3 (Contests & Problem Bank Backend)** | 32 | 32 | 0 | 100% |
| **Phase 4A (Judge, Runners, Sandboxing)** | 36 | 36 | 0 | 100% |
| **Phase 4A Extra (Security & Profiles)** | 40 | 40 | 0 | 100% |
| **Phase 4B.1 (Test Generation & Oracles)** | 46 | 46 | 0 | 100% |
| **Phase 4B.2 (Edge & Boundary Generator)** | 18 | 18 | 0 | 100% |
| **Phase 4B.3 (Anti-Cheat & Static Analysis)** | 29 | 29 | 0 | 100% |
| **Phase 4B.4 (Adversarial Security)** | 24 | 24 | 0 | 100% |
| **Phase 4B.5 (Multi-Stage Persistence)** | 33 | 33 | 0 | 100% |
| **Phase 4B.6 (Adversarial Sandbox Defense)** | 12 | 12 | 0 | 100% |
| **Phase 4B.7 (Stabilization & Concurrency)** | 21 | 21 | 0 | 100% |
| **TOTAL ACROSS PLATFORM** | **567** | **567** | **0** | **100%** |

---

## 7. Phase 5.5 — Contest Leaderboard + Live Standings Implementation

### 7.1 Architecture & Authoritative Standings Engine
- **Single Source of Truth (`backend/src/services/standingsService.js`):** Built a dedicated, high-performance Standings Service that serves as the single authoritative rank calculator for both the public Leaderboard API (`GET /api/contests/:id/leaderboard`) and the Elo Rating Finalization engine (`RatingService.finalizeContestRatings`). The client UI never calculates ranks independently.
- **Deterministic 4-Tier Tie-Breaking:**
  1. Primary: Higher `totalScore` (points awarded for accepted problems).
  2. Secondary: Lower `totalPenaltyMinutes` (sum of accepted time offset in minutes $+ 20\text{m} \times \text{rejected attempts on solved problems}$).
  3. Tertiary: Earlier `lastAcceptedAt` (first to complete all solved problems).
  4. Quaternary: Lower `userId` ascending for absolute determinism.
- **Problem-by-Problem Scoreboard Matrix ($P_1, P_2, \dots, P_n$):** Computes per-problem solve status (`solved`, `failed`, `unattempted`), awarded points, failed attempts before solve, time of solve, and penalty contribution.
- **Leaderboard Freeze System:** Configurable freeze window (`leaderboardFreezeEnabled`, `leaderboardFreezeMinutes`). Submissions during the freeze continue to be evaluated normally by the judge engine in the background, while the public visible scoreboard remains frozen at the cutoff. Contest managers can view the true unmasked standings with `freezeOverride=true`.
- **Automatic Unfreeze & Rating Handoff:** Finalizing contest ratings automatically lifts the freeze and populates each student's `userPosition.ratingChange` directly from `rating_history`.

### 7.2 Frontend User Experience (`frontend/src/components/ContestLeaderboard.jsx`)
- **Top 3 Podium (🥇 Gold, 🥈 Silver, 🥉 Bronze):** Visual cards highlighting top competitors with custom Code Core emblems, solve counts, points, and handles.
- **"YOUR POSITION" Dedicated Callout:** Sticky banner showing the current student's rank, solved count out of total, score, penalty, and rating delta.
- **Server-Authoritative Countdown Clock:** Resynchronizes with server time and decrements locally every second (`LIVE` / `FROZEN` / `ENDED` / `FINALIZED`).
- **Interactive Scoreboard Table:** Sticky headers, `[ YOU ]` row highlight with glowing border, problem cell chips (`✓ +1 (18m)`, `✗ -3`, `—`), real-time search, and pagination.

---

## 8. Phase 5.6 — Global + College Leaderboard Implementation

### 8.1 Architecture & Authoritative Global Ranking Service (`backend/src/services/globalRankingService.js`)
- **Single Authoritative Source of Truth:** Global rank is strictly determined from the canonical `users.current_rating` populated and finalized by Phase 5.4's Elo engine. Ratings are never recalculated client-side.
- **Deterministic Tie-Breaking:**
  - Ranked order: `ORDER BY u.current_rating DESC, u.id ASC`.
  - User position rank calculation: `SELECT COUNT(*)::int + 1 AS rank FROM users WHERE role = 'student' AND is_active = true AND (current_rating > $1 OR (current_rating = $1 AND id < $2))`.
  - College rank calculation: Same exact deterministic formula isolated with `AND LOWER(institution) = LOWER($institution)`.
- **Custom Rating Tiers (`backend/src/config/ratingConfig.js`):**
  Platform-specific rating tiers configured cleanly:
  1. **Elite** (Rating 2200+) — Rose `#f43f5e`
  2. **Master** (Rating 1900–2199) — Amber `#f59e0b`
  3. **Specialist** (Rating 1600–1899) — Purple `#a855f7`
  4. **Expert** (Rating 1400–1599) — Blue `#3b82f6`
  5. **Challenger** (Rating 1200–1399) — Cyan `#06b6d4`
  6. **Explorer** (Rating 0–1199) — Slate `#94a3b8`

### 8.2 College League & Institutional Filtering
- **Schema & Persistence:** Extended `users` table with `institution VARCHAR(150) DEFAULT ''` and composite indexes (`idx_users_institution`, `idx_users_rating_desc_id_asc`).
- **College Isolation:** Selecting a college filters standings strictly to enrolled students of that institution, computing real-time relative College Rank while preserving Global Rank and overall platform percentile.
- **Institutional Fallback & Onboarding:** If an authenticated student has not yet entered an institution, a helpful badge and direct shortcut `[ Set College in Profile ]` allows instant updating.
- **Institutions Dropdown:** Automatically aggregates active universities and institutions with student counts (`GET /api/leaderboard?scope=college`).

### 8.3 Logged-in User Position Sticky Callout (`userPosition`)
- Returns the authenticated student's Global Rank, College Rank (if affiliated), Rating Tier, Current Rating, Peak Rating, and platform percentile ($P = \frac{\text{students below}}{\text{total active}} \times 100\%$).
- Accurately computed on the server even when the user is not visible on page 1 of the paginated standings table.

### 8.4 Historical Leaderboard Snapshots API (`leaderboard_snapshots`)
- **Schema:** Table `leaderboard_snapshots` with columns `(id, scope, institution, snapshot_date, user_id, rank, current_rating, rating_status, rated_contest_count, problems_solved_count, captured_at)`.
- **Endpoints:**
  - `POST /api/leaderboard/snapshots` — Administrative endpoint for professors/super-admins to freeze and archive historical platform leaderboard states.
  - `GET /api/leaderboard/snapshots` — Retrieve past snapshot records by scope and date.

### 8.5 Anti-Tamper & Security Hardening
- **Rating Field Stripping (`backend/src/middleware/validationMiddleware.js`):** `validateUpdateProfile` strips `current_rating`, `highest_rating`, `rating_status`, `rank`, `rated_contest_count` from incoming request bodies. Students cannot modify their rating or status via profile updates.
- **Privacy Enforcement:** Public leaderboard endpoints strictly exclude `password_hash`, private email addresses of other users, and verification tokens.

### 8.6 Frontend Experience (`frontend/src/components/GlobalLeaderboard.jsx`)
- **Scope Segmented Control:** Switch seamlessly between `Global Arena` (platform-wide) and `College League` (institutional).
- **Top 3 Podium (🥇 Gold, 🥈 Silver, 🥉 Bronze):** Spotlight cards displaying top competitive coders with animated halos and custom Code Core emblems.
- **Platform Analytics & Rating Distribution Histogram:** Interactive histogram showing coder distribution across the 6 platform tiers with instant one-click tier filtering.
- **Standings Table:** Search by username or full name, filter by rating status (`Rated` vs `Provisional`) and rating tier, `[ YOU ]` highlighted row, and server-side pagination controls.

---

## 9. Files Created & Modified in Phase 5.6

| File | Status | Description |
|---|---|---|
| `backend/src/services/globalRankingService.js` | Created | Authoritative Global & College ranking service, deterministic rank calculations, KPIs, distribution, snapshots |
| `backend/src/controllers/leaderboardController.js` | Created | Controller for global/college standings, platform stats, and snapshot creation |
| `backend/src/routes/leaderboardRoutes.js` | Created | Routing for `/api/leaderboard`, `/api/leaderboard/global`, `/api/leaderboard/college`, `/api/leaderboard/stats`, `/api/leaderboard/snapshots` |
| `backend/src/config/ratingConfig.js` | Created | Platform rating tiers (`Elite`, `Master`, `Specialist`, `Expert`, `Challenger`, `Explorer`) and distribution buckets |
| `backend/src/models/userModel.js` | Modified | Added `institution` column to user queries, profile updates, and sanitization |
| `backend/src/services/authService.js` | Modified | Added `institution` to `sanitizeUser` |
| `backend/src/controllers/userController.js` | Modified | Updated `updateProfile` and `getCoderIdentity` to process and return `institution` |
| `backend/src/middleware/validationMiddleware.js` | Modified | Added `institution` validation and anti-tamper rating field stripping |
| `backend/src/routes/testCaseRoutes.js` | Modified | Scoped `authenticate` middleware to testcase routes to prevent intercepting public leaderboard routes |
| `backend/src/routes/index.js` | Modified | Mounted `/api/leaderboard` routes |
| `backend/src/database/schema.sql` | Modified | Added `institution` to `users`, `leaderboard_snapshots` table, and composite indexes |
| `backend/src/config/initDb.js` | Modified | Added incremental migration for `institution`, `leaderboard_snapshots`, and indexes |
| `frontend/src/components/GlobalLeaderboard.jsx` | Created | Global + College Leaderboard component with Scope control, Podium, User Position Banner, Histogram, Table, and Pagination |
| `frontend/src/components/Navbar.jsx` | Modified | Added Leaderboard navigation link to desktop and mobile navigation menus |
| `frontend/src/App.jsx` | Modified | Added `/leaderboard` routing and `'rankings'` view state rendering |
| `frontend/src/components/Settings.jsx` | Created | Dedicated Settings & Preferences component (Theme switcher, Profile settings, Workspace preferences, Security overview) |
| `frontend/src/components/UserProfile.jsx` | Modified | Embedded Settings tab, public/private tab navigation, and enhanced Coder Identity Matrix display |
| `frontend/src/components/Navbar.jsx` | Modified | Cleaned up top navigation bar by moving inline theme switcher to Settings component |
| `frontend/src/App.jsx` | Modified | Wrapped standard page views in `page-viewport-scrollable` flex container for full scrolling across all pages |
| `frontend/src/index.css` | Modified | Added complete Coder Profile Matrix, Settings component styles, and universal cross-browser scrollbar styling |
| `report/phase_5_report.md` | Modified | Consolidated master report encompassing Phases 5.1 through 5.6 and UX polish |

---

## 9.1 Coder Profile Restoration, Dedicated Settings & Global Scrollbar Architecture

### 1. Global Scrollbar & Layout System
- **Problem Resolved:** The viewport container previously prevented smooth scrolling across various views (`ProblemExplorer`, `StudentDashboard`, `GlobalLeaderboard`, `SubmissionHistory`, `UserProfile`).
- **Solution:** Replaced rigid fixed overflow rules with a flexible layout:
  - `html, body`: Smooth background transition, zero margin, unconstrained horizontal flow.
  - `.app-container`: Full-height flex column layout with navigation header.
  - `.page-viewport-scrollable`: Dedicated scrollable viewport container for all primary views (`flex: 1; overflow-y: auto; overflow-x: hidden; height: calc(100vh - 58px); scroll-behavior: smooth;`).
  - Native Code Workspace (`activeView === 'workspace'`) retains its dedicated split-pane layout with Monaco editor.
  - Universal cross-browser scrollbar styling applied via `* { scrollbar-width: thin; scrollbar-color: var(--border-color) transparent; }` and `::-webkit-scrollbar` pseudo-elements.

### 2. Coder Profile Identity Matrix Restoration
- **Problem Resolved:** The Coder Profile page rendered with broken / unstyled text due to missing CSS classes.
- **Solution:** Restored high-precision, theme-aware CSS stylesheets for all profile matrix components:
  - **Coder Identity Hero Card:** Dynamic vector Code Core Emblem, display name, handle (`@username`), role badge, member since year, college / university tag, public bio, and profile completion bar.
  - **Competitive Rating Core Hero:** Large Elo digits styled with custom tier color, rating tier pill, provisional/rated status indicator, and 4-stat core matrix (Global Rank, Peak Rating, Rated Contests count, Unique Problems Solved).
  - **Performance Snapshot:** Acceptance Rate, Total Submissions, Average Runtime, and Average Memory.
  - **Visual Domain Split:** `DifficultyOrbit` circular SVG segmented ring and `TopicConstellation` interactive star network graph.
  - **Contest Journey & Progression Curve:** Interactive SVG Elo timeline with hover tooltips and history table.
  - **Recent Activity Stream:** Detailed verdicts, difficulty pills, and timestamps.

### 3. Dedicated Settings Component (`frontend/src/components/Settings.jsx`)
- **Features Included:**
  - **Interface Appearance:** 3 selectable visual cards (`☀️ Light Mode`, `🌙 Dark Mode`, `💻 System Sync`) with live theme updates using `useTheme()`.
  - **Coder Identity & Public Bio:** Editable Full Name, Username, College/University affiliation (supporting College League leaderboards), Bio, and Avatar Image URL.
  - **Practice Workspace Preferences:** Default practice language selection (C++ 20, Python 3.11, Java 21), Monaco Editor Font Size (13px, 14px, 16px), Tab size (2 or 4 spaces), and Auto-closing quotes/brackets toggles.
  - **Account & Security Overview:** Read-only registered email, account role, and rating status overview.
  - **Integrated in Profile:** Clean tab navigation inside `UserProfile.jsx` allowing users to switch between `[ 📊 Identity Matrix ]` and `[ ⚙️ Settings & Preferences ]`.

### 4. Clean Top Navbar
- Removed the inline `[ Light | Dark | System ]` theme toggle buttons from the top desktop navbar to ensure a clean, minimal, and uncluttered navigation bar.

---

## 9.2 Navigation + UI/UX Architecture Refactor (AppShell, Sidebar, TopBar, Command Palette & Contextual Workspace)

### 1. Unified AppShell Architecture
- Replaced the overcrowded horizontal navigation bar with a modular, highly scalable application shell:
  - **`AppShell` (`frontend/src/components/navigation/AppShell.jsx`):** Coordinates sidebar state, top bar context, command palette modal, mobile drawer, and global keyboard shortcuts.
  - **`Sidebar` (`frontend/src/components/navigation/Sidebar.jsx`):** Clean vertical sidebar structured into 3 distinct logical groups:
    - **MAIN:** `Home` (`landing`), `Problems` (`problems`), `Contests` (`dashboard`).
    - **COMPETE:** `Dashboard` (`dashboard`), `Leaderboard` (`rankings`), `Submissions` (`submissions`).
    - **ACCOUNT:** `Profile` (`profile`), `Settings` (`settings`).
  - **Collapsible Sidebar (`Ctrl+B`):** Smooth animation between expanded (230px) and compact collapsed (66px) states with accessible floating tooltips and state persistence in `localStorage` (`securejudge_sidebar_collapsed`).

### 2. Minimal Context-Aware TopBar
- **`TopBar` (`frontend/src/components/navigation/TopBar.jsx`):**
  - **Dynamic Breadcrumbs:** Clean path trails (`Problems / Two Sum`, `Dashboard / DSA Contest #4`, `Leaderboard / Global Arena`, `Profile / Settings`) with smart mobile truncation.
  - **Command Palette Search Pill:** Instant search button with `Ctrl + K` badge.
  - **Notification Foundation (`NotificationCenter.jsx`):** Bell icon with unread badge counter, empty state, and future-ready schema without fake data.
  - **User Profile Menu:** CoderEmblem avatar, username, role badge, quick links to Profile and Settings, 3-way theme selector (`Light | Dark | System`), and logout.

### 3. Context-Aware Maximized Coding Workspace Layout
- **`WorkspaceTopBar` (`frontend/src/components/navigation/WorkspaceTopBar.jsx`):**
  - Replaces standard page chrome when `activeView === 'workspace'`.
  - Displays back button (`← Problems`), Problem Title & Difficulty Badge (`diff-easy`, `diff-medium`, `diff-hard`), active contest timer & status, language selector (C++, Python, Java), reset starter code template, Run tests button, and Submit solution button.
  - Gives Monaco editor and Problem Pane maximum usable height and width (`height: calc(100vh - 48px)`).

### 4. Global Command Palette (`Ctrl + K`)
- **`CommandPalette` (`frontend/src/components/navigation/CommandPalette.jsx`):**
  - Triggered globally via `Ctrl+K` (or `Cmd+K` on Mac) or by clicking the TopBar search bar.
  - Live filtering across platform navigation destinations, theme switching actions (`Light`, `Dark`, `System`), sidebar collapse toggling (`Ctrl+B`), and direct problem shortcuts.
  - Full keyboard navigation with `ArrowUp`, `ArrowDown`, `Enter` to select, and `Escape` to close.

### 5. Role-Aware Navigation Foundation
- Navigation configuration structured in `frontend/src/config/navConfig.js` supporting role-based access filtering for `STUDENT`, `PROFESSOR`, and `SUPER_ADMIN`.

---

## 9.3 Step 3 — Comprehensive API Security Audit & Vulnerability Hardening

### 1. Complete API Inventory & Classification
Audited all 48 backend endpoints across 10 functional modules:

| Module | Method | Endpoint | Auth | Role | Ownership Check | Rate Limit | Status |
|---|---|---|---|---|---|---|---|
| **Auth** | POST | `/api/auth/register` | No | Public | N/A | `authRateLimiter` | Verified Hardened |
| **Auth** | POST | `/api/auth/login` | No | Public | N/A | `authRateLimiter` | Verified Hardened |
| **User** | GET | `/api/users/me` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **User** | GET | `/api/users/me/identity` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **User** | PUT | `/api/users/me` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **User** | GET | `/api/users/dashboard` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **User** | GET | `/api/users/:id/rating` | Yes | Any | Public/Self | `mediumProtection` | Verified Hardened |
| **User** | GET | `/api/users/:id/rating-history` | Yes | Any | Public/Self | `mediumProtection` | Verified Hardened |
| **User** | GET | `/api/users/u/:idOrUsername` | Opt | Public | Self check for email | `mediumProtection` | Verified Hardened |
| **User** | GET | `/api/users/:id/public-profile` | No | Public | N/A | `mediumProtection` | Verified Hardened |
| **Problems** | POST | `/api/problems` | Yes | Professor+ | Creator (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **Problems** | GET | `/api/problems` | Yes | Any | N/A | `mediumProtection` | Verified Hardened |
| **Problems** | GET | `/api/problems/saved` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **Problems** | POST | `/api/problems/:id/bookmark` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **Problems** | DELETE | `/api/problems/:id/bookmark` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **Problems** | GET | `/api/problems/:id` | Yes | Any | Sample cases only | `mediumProtection` | Verified Hardened |
| **Problems** | PUT | `/api/problems/:id` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Problems** | DELETE | `/api/problems/:id` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Validation** | GET | `/api/problems/:id/validation-config` | Yes | Professor+ | N/A | `mediumProtection` | Verified Hardened |
| **Validation** | POST/PUT | `/api/problems/:id/validation-config` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Validation** | DELETE | `/api/problems/:id/validation-config` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Test Cases** | POST | `/api/problems/:id/test-cases` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Test Cases** | GET | `/api/problems/:id/test-cases` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Test Cases** | PUT | `/api/test-cases/:id` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Test Cases** | DELETE | `/api/test-cases/:id` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Contests** | POST | `/api/contests` | Yes | Professor+ | Creator (`req.user.id`) | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | GET | `/api/contests` | Yes | Any | Status filtered | `mediumProtection` | Verified Hardened |
| **Contests** | GET | `/api/contests/:id` | Yes | Any | Draft check | `mediumProtection` | Verified Hardened |
| **Contests** | PUT | `/api/contests/:id` | Yes | Professor+ | `canManageResource` | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | DELETE | `/api/contests/:id` | Yes | Professor+ | `canManageResource` | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | POST | `/api/contests/:id/publish` | Yes | Professor+ | `canManageResource` | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | POST | `/api/contests/:id/problems` | Yes | Professor+ | `canManageResource` | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | DELETE | `/api/contests/:id/problems/:pId` | Yes | Professor+ | `canManageResource` | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | POST | `/api/contests/:id/join` | Yes | Any | Duplicate check | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | GET | `/api/contests/:id/participants` | Yes | Professor+ | `canManageResource` | `mediumProtection` | Verified Hardened |
| **Contests** | POST | `/api/contests/:id/finalize-ratings`| Yes | Professor+ | `canManageResource` | `contestActionRateLimiter` | Verified Hardened |
| **Contests** | GET | `/api/contests/:id/leaderboard` | Opt | Any | Freeze check | `mediumProtection` | Verified Hardened |
| **Submissions**| POST | `/api/submissions` | Yes | Any | Self (`req.user.id`) | `submitCodeRateLimiter` | Verified Hardened |
| **Submissions**| POST | `/api/submissions/run` | Yes | Any | Self (`req.user.id`) | `runCodeRateLimiter` | Verified Hardened |
| **Submissions**| GET | `/api/submissions/my` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **Submissions**| GET | `/api/submissions/analytics` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **Submissions**| GET | `/api/submissions/export` | Yes | Any | Self (`req.user.id`) | `mediumProtection` | Verified Hardened |
| **Submissions**| GET | `/api/submissions/:id` | Yes | Any | Owner / Admin | `mediumProtection` | Verified Hardened |
| **Submissions**| GET | `/api/submissions/:id/code` | Yes | Any | Owner / Admin | `mediumProtection` | Verified Hardened |
| **Leaderboard**| GET | `/api/leaderboard` | Opt | Public | Server rank computed | `mediumProtection` | Verified Hardened |
| **Leaderboard**| GET | `/api/leaderboard/stats` | No | Public | Aggregated stats | `mediumProtection` | Verified Hardened |
| **Leaderboard**| POST | `/api/leaderboard/snapshots` | Yes | Admin/Prof | Snapshot capture | `mediumProtection` | Verified Hardened |
| **Leaderboard**| GET | `/api/leaderboard/snapshots` | Opt | Public | Historical view | `mediumProtection` | Verified Hardened |
| **Health** | GET | `/api/health` | No | Public | N/A | None | Verified Hardened |

### 2. Key Vulnerability Hardening Applied
1. **Dependency Vulnerability Remediation:** Added override `"tar": "^7.4.3"` resolving all transitive vulnerabilities in `node-tar` (`found 0 vulnerabilities` via `npm audit`).
2. **PostgreSQL Parameter Validation & Error Mapping:** Updated `errorHandler.js` to map PostgreSQL input syntax error `22P02` to HTTP 400 (`Invalid resource identifier format`) and unique violation `23505` to HTTP 409 (`Resource conflict`), preventing unhandled 500 error leakages.
3. **Privileged Action Audit Logger:** Built centralized `AuditLogger` service (`backend/src/services/auditLogger.js`) to record structured security audit trails for contest publishing, contest deletion, problem lifecycle, test-case management, validation config updates, and leaderboard snapshots.
4. **Helmet CSP Keywords Alignment:** Standardized Content-Security-Policy keyword quotation (`'self'`, `'unsafe-inline'`, `'unsafe-eval'`, `'none'`) eliminating browser and Helmet parser warnings.

---

## 9.4 Phase 5.7.1 — Skill Data Model + Calculation Foundation

### 1. Database Models & Schema Extensions
1. **`topics` Table (`backend/src/database/schema.sql`):**
   - Canonical store for platform algorithmic topics (`id`, `key`, `name`, `category`, `description`, `created_at`, `updated_at`).
   - Pre-seeded with 16 canonical topic taxonomies (Arrays, Strings, Hashing, Two Pointers, Sliding Window, Binary Search, Linked Lists, Stacks & Queues, Trees, Graphs, Heap, Greedy, Dynamic Programming, Backtracking, Bit Manipulation, Math).
2. **`problem_topics` Table:**
   - Normalized multi-topic junction (`problem_id`, `topic_id`, `PRIMARY KEY (problem_id, topic_id)`).
   - Allows problems to belong to single or multiple algorithmic categories without duplication.
3. **`user_skills` Table:**
   - Persistent user skill state (`id`, `user_id`, `topic_id`, `score`, `level`, `confidence`, `attempted_count`, `solved_count`, `last_attempt_at`, `last_solved_at`, `calculation_version`, `created_at`, `updated_at`).
   - Unique constraint `uq_user_skills_user_topic UNIQUE (user_id, topic_id)` prevents duplicate records per user per topic.
   - Levels enforced via check constraint: `'BEGINNER'`, `'DEVELOPING'`, `'PROFICIENT'`, `'ADVANCED'`, `'EXPERT'`.
4. **Performance Indexes Added:**
   - `idx_topics_key`, `idx_topics_category`
   - `idx_problem_topics_problem_id`, `idx_problem_topics_topic_id`
   - `idx_user_skills_user_id`, `idx_user_skills_topic_id`, `idx_user_skills_level`

### 2. Skill Calculation Service Architecture (`backend/src/services/skillCalculationService.js`)
- **Strict Separation of Concerns:**
  - `collectSkillEvidence(userId, topicId)`: Gathers raw submission judgments and deduplicated problem associations into structured `SkillEvidence` records.
  - `calculateSkill(evidenceList, existingSkill)`: Evaluates evidence and produces foundation metrics (`attemptedCount`, unique `solvedCount`, baseline `score`, `level`, `confidence`, `calculationVersion: 1`).
  - `persistSkill(userId, topicId, calculatedData)`: Atomically upserts state to PostgreSQL using `ON CONFLICT (user_id, topic_id) DO UPDATE`.
  - `processSubmissionEvent(submissionId)`: Asynchronously recalculates and persists skills for all topics linked to the evaluated problem.

### 3. Background Job & Judge Queue Integration
- Connected asynchronously via `setImmediate` in `backend/src/judge/queue/judgeQueue.js` upon completion of official submissions.
- Ensures zero blocking or performance overhead on the critical judge evaluation worker loop.

### 4. REST API Endpoints & Security
- `GET /api/skills/topics` (Public topic taxonomy).
- `GET /api/skills/my` and `GET /api/users/me/skills` (Authenticated student's detailed skill state and totals).
- `GET /api/skills/user/:idOrUsername` (Privacy-filtered user skills; hides private score metrics from other students).

---

## 9.5 Testing Performance & Efficiency Optimization

### 1. Unified Test Runner Engines (`backend/scripts/testRunner.js` & `frontend/scripts/testRunner.js`)
- **Category-Based Targeted Execution:**
  - `npm run test:skills` (Phase 5.7.1 UserSkill data model, calculation foundation, event hooks, and APIs in ~2.1s).
  - `npm run test:unit` (Static analysis, edge/boundary generators, anti-hardcoding heuristics).
  - `npm run test:api` (Auth, profiles, contests, problems, submissions, skills REST APIs in ~10.1s).
  - `npm run test:security` (RBAC, BOLA/IDOR, rate limiting, security headers, judge adversarial tests).
  - `npm run test:judge` (Judge compilation, sandbox containment, random test oracles, language parity).
  - `npm run test:fast` (Rapid feedback test group omitting long compilation timeouts).
  - `npm run test:nav` / `npm run test:auth` / `npm run test:dashboard` (Targeted frontend component suites).
  - `npm run test:regression` (Full consolidated regression verification across all 22 test suites).
- **Exact Timing Benchmarking & Diagnostics:**
  - Integrated per-suite timing tracking in seconds and milliseconds.
  - Automatically identifies and reports the top slowest suites (e.g. `test_phase4b7_stabilization.js` due to multi-compiler C++/Java invocation) and execution bottlenecks.
- **Automated Ephemeral Backend Lifecycle:**
  - Frontend test runner detects backend health on port 5000 and automatically manages test backend server lifecycles if offline.
  - Standardized `x-test-environment` header ensures tests run without triggering development rate limits.

---

## 9.6 Phase 5.7.2 — Deterministic Skill Scoring Engine

### 1. Mathematical Scoring Formula & Nuances
- **Bounded Range:** $0.00 \le \text{Score} \le 100.00$ with stable two-decimal precision.
- **Difficulty Multipliers:**
  - `easy`: $1.0\times$ ($15.00$ base points)
  - `medium`: $2.0\times$ ($30.00$ base points)
  - `hard`: $3.5\times$ ($52.50$ base points)
  - Fallback: $1.0\times$ for unknown or missing difficulty strings.
- **Deterministic Recency Step Decay:**
  - $\le 14\text{ days}$: $1.00\times$ (100% credit)
  - $\le 45\text{ days}$: $0.90\times$ (90% credit)
  - $\le 90\text{ days}$: $0.80\times$ (80% credit)
  - $\le 180\text{ days}$: $0.70\times$ (70% credit)
  - $> 180\text{ days}$: $0.60\times$ (60% baseline mastery floor)
- **Anti-Farming & Deduplication Invariants:**
  - Multiple submissions to the same problem contribute to `attemptedCount`, but solved problem points are strictly deduplicated by `problemId`. Repeating the same easy problem cannot inflate skill points.
- **Accuracy Quality Factor:**
  $$\text{factor} = \max\left(0.60, \min\left(1.00, \frac{S}{S + 0.15 \times F}\right)\right)$$
  Dampens scores for reckless submit-spamming while guaranteeing at least 60% floor for solves.
- **Multi-Problem Breadth Saturation:**
  - Solved count $S=1 \implies \text{Cap} = 35.00$ (Single-problem mastery capped at Developing)
  - Solved count $S=2 \implies \text{Cap} = 55.00$
  - Solved count $S=3 \implies \text{Cap} = 75.00$
  - Solved count $S \ge 4 \implies \text{Cap} = 100.00$ (Advanced & Expert levels require multi-problem depth)
- **Skill Level Classification:**
  - $[0.00, 20.00) \implies \text{BEGINNER}$
  - $[20.00, 45.00) \implies \text{DEVELOPING}$
  - $[45.00, 70.00) \implies \text{PROFICIENT}$
  - $[70.00, 90.00) \implies \text{ADVANCED}$
  - $[90.00, 100.00] \implies \text{EXPERT}$
- **Versioning & Concurrency Protection:**
  - Explicit `CALCULATION_VERSION = 2`.
  - Out-of-order race condition protection in `persistSkill` prevents older background calculations from overwriting newer user activity.

### 2. Comprehensive Test Verification (`test_phase5_7_2_skills.js`)
- 22/22 required test scenarios implemented and passing 100%:
  - Empty activity state (score 0.00, BEGINNER).
  - Easy vs Hard problem difficulty scaling.
  - Failed-only submissions (score 0.00).
  - Mixed solve/fail accuracy penalties.
  - Multi-solve scaling and deduplication.
  - Recency step decay verification (fresh vs 1-year-old solve).
  - Multi-topic isolation (Arrays solve does not create DP skill).
  - Multi-topic tagged problem propagation (problem tagged with Arrays & Hashing creates both skills).
  - Score bounds ($0.00 \le \text{score} \le 100.00$).
  - Calculation determinism and 2-decimal rounding stability.
  - Invalid difficulty graceful fallback.
  - Idempotent repeated recalculations.
  - Privacy boundary isolation (raw score hidden from third-party students).
  - Client-side payload tampering protection (score is server-authoritative).
  - Submission queue event-driven recalculation.
  - Stale calculation race condition protection.

---

## 9.7 Phase 5.7.3 — Confidence & Evidence Layer

### 1. Architectural Separation: Performance Score vs Evidence Confidence
- **Skill Score ($0.00 \le \text{Score} \le 100.00$):** Reflects the algorithmic proficiency and problem-solving level demonstrated on solved problems.
- **Confidence ($0.00 \le \text{Confidence} \le 100.00$):** Measures the quantity, diversity, consistency, and recency of authoritative evidence supporting that measurement.
- **Explainable Independence:** A user who cleanly solves a single difficult problem achieves a high skill score ($75.00$) alongside moderate-low confidence ($28.00$).

### 2. Mathematical Confidence Formula & Anti-Spam Guardrails
$$\text{Confidence} = \text{clamp}\Big(0.00, 100.00, C_{\text{diversity}} + C_{\text{volume}} + C_{\text{quality}} + C_{\text{recency}}\Big)$$

1. **Problem Diversity Component ($C_{\text{diversity}} \le 50.00$):**
   - Driven by distinct solved problems $D_{\text{sol}}$: $\min(50.00, 12.50 \times D_{\text{sol}})$.
2. **Attempt & Solve Volume Component ($C_{\text{volume}} \le 25.00$):**
   - Distinct attempted problems contribution: $\min(15.00, 3.00 \times D_{\text{att}})$.
   - Evaluated submission volume contribution (anti-spam capped): $\min(10.00, 1.00 \times A_{\text{tot}})$.
3. **Evidence Quality / Outcome Consistency ($C_{\text{quality}} \le 15.00$):**
   - Distinct solve ratio: $\text{solveRatio} = \frac{D_{\text{sol}}}{\max(1, D_{\text{att}})}$.
   - Formula: $15.00 \times \text{solveRatio} \times \min(1.0, D_{\text{sol}} / 2.0)$.
4. **Recency Support ($C_{\text{recency}} \le 10.00$):**
   - $\le 30\text{ days elapsed}: +10.00\text{ pts}$
   - $\le 90\text{ days elapsed}: +7.00\text{ pts}$
   - $\le 180\text{ days elapsed}: +4.00\text{ pts}$
   - $> 180\text{ days elapsed}: +2.00\text{ pts}$
   - No solves: $0.00\text{ pts}$.
5. **Anti-Farming Guarantee:**
   - 50 repeat submissions on 1 problem yields $D_{\text{sol}} = 1$, capping confidence under 45.00.

### 3. Structured Evidence Aggregation (`aggregateEvidence`)
- `distinctProblemsAttempted`: Count of unique problem IDs attempted in this topic.
- `distinctProblemsSolved`: Count of unique problem IDs solved in this topic.
- `successfulEvidence`: Total accepted submissions count.
- `failedEvidence`: Total failed/non-accepted submissions count.
- `totalAttempts`: Total evaluated submissions count.
- `recentEvidence`: Count of distinct problems solved within the last 90 days.
- `evidenceUpdatedAt`: Timestamp of the latest evaluated evidence.

### 4. Database, Versioning & API Integration
- `user_skills.confidence` migrated to `NUMERIC(6, 2) NOT NULL DEFAULT 0.00`.
- Version updated to `CALCULATION_VERSION = 3`.
- Authenticated endpoints `/api/skills/my` and `/api/users/me/skills` return both `score`, `level`, `confidence`, and `evidence` summaries.
- Public views `/api/skills/user/:idOrUsername` expose public confidence and levels while shielding private scores.

### 5. Automated Test Suite (`test_phase5_7_3_skills.js`)
- 51/51 automated assertions passing across all 26 required scenarios (empty state, single solve, distinct vs repeated solves, attempt spamming, mixed outcomes, recency boost vs baseline preservation, multi-topic isolation, boundaries, determinism, rounding, version 3, queue events, concurrency, stale protection, authorization, and client tamper immunity).

---

## 9.8 Phase 5.7.4 — Progress History & Trends

### 1. Architectural Model & Data Schema (`user_skill_history`)
- **Append-Oriented Storage:** Preserves historical snapshots with:
  - `user_skill_id`: References `user_skills(id) ON DELETE CASCADE`.
  - `user_id`, `topic_id`: Scoped indices for rapid time-series lookups.
  - `score`, `level`, `confidence`: Historical performance values at snapshot time.
  - `attempted_count`, `solved_count`: Volume metrics.
  - `distinct_problems_attempted`, `distinct_problems_solved`: Breadth metrics.
  - `calculation_version`: Retains scoring algorithm version (version 3).
  - `trigger_submission_id`: Optional audit link to triggering submission.
  - `recorded_at`: Server-authoritative UTC `TIMESTAMP WITH TIME ZONE`.
- **Database Indexes:**
  - `idx_user_skill_history_user_topic_date (user_id, topic_id, recorded_at DESC)`
  - `idx_user_skill_history_user_skill_id (user_skill_id)`
  - `idx_user_skill_history_recorded_at (recorded_at DESC)`

### 2. Duplicate Snapshot Suppression
- **Intelligent Deduplication:** When `SkillCalculationService.persistSkill` executes, it evaluates the previous snapshot for `(user_id, topic_id)`.
- If `score`, `confidence`, `solved_count`, `attempted_count`, and `distinct_problems_solved` are identical ($|\Delta S| < 0.01$ and $|\Delta C| < 0.01$), duplicate snapshot creation is suppressed (`isDuplicateSuppressed: true`).
- If any metric has changed (e.g. higher score, increased confidence, new solve), a new append-only snapshot is persisted.

### 3. Deterministic Trend Calculation & Stability Threshold
- **Change Metrics:**
  - $\text{Absolute Change} = S_{\text{latest}} - S_{\text{prev}}$
  - $\text{Percentage Change} = S_{\text{prev}} > 0 ? \left(\frac{S_{\text{latest}} - S_{\text{prev}}}{S_{\text{prev}}}\right) \times 100\% : 0.00\%$
  - $\text{Confidence Change} = C_{\text{latest}} - C_{\text{prev}}$
- **Stability Threshold ($\epsilon = 1.00$ point):**
  - $\Delta S > 1.00 \implies \text{Direction} = \text{'improving'}$
  - $\Delta S < -1.00 \implies \text{Direction} = \text{'declining'}$
  - $|\Delta S| \le 1.00 \implies \text{Direction} = \text{'stable'}$
- **Initial & Empty States:** 0 snapshots yields `status: 'no_data'`; 1 snapshot yields `status: 'initial'` with $\Delta = 0.00$.

### 4. Bounded Query APIs & Security Privacy Scoping
- **Endpoints:**
  - `GET /api/skills/my/history`: Authenticated user progress history across topics with overall trend summary.
  - `GET /api/skills/my/history/:topicKey`: Authenticated user progress history and deterministic trend for a specific topic.
  - `GET /api/skills/user/:idOrUsername/history`: Scoped public user skill history (private scores strictly omitted for other students; public levels and confidence preserved).
- **Protection Bounds:**
  - Strict pagination limit cap at 100 items max (`Math.min(100, Math.max(1, limit))`).
  - Immutability: Client `POST`, `PUT`, `DELETE` requests to history endpoints return 404/405 (history is strictly server-authoritative).

### 5. Automated Test Suite (`test_phase5_7_4_skills.js`)
- 43/43 automated assertions passing across all 26 required scenarios (snapshot creation, duplicate suppression, delta calculations, improving/declining/stable trends, stability thresholds, pagination, date filtering, queue events, concurrency, calculationVersion preservation, and API privacy boundaries).

---

## 9.9 Phase 5.7.5 — Strengths & Needs Practice Classification

### 1. Deterministic Classification States
- **`STRENGTH`**: High measured performance backed by strong confidence and non-declining progress.
- **`NEEDS_PRACTICE`**: Low performance or declining trend with sufficient evidence of struggle.
- **`DEVELOPING`**: Active progression in motion, moderate confidence, or score not yet in extreme thresholds.
- **`STABLE`**: Moderate score with solid confidence and flat/stable trend.
- **`UNASSESSED`**: No meaningful attempts or evaluation evidence.

### 2. Centralized Threshold Rules & Low-Confidence Safeguards
- **Threshold Constants:**
  - $\text{MIN\_CONFIDENCE\_STRENGTH} = 45.00$
  - $\text{MIN\_SCORE\_STRENGTH} = 65.00$
  - $\text{HIGH\_SCORE\_STRENGTH} = 80.00$ ($\text{MIN\_CONFIDENCE} = 40.00$)
  - $\text{MIN\_CONFIDENCE\_NEEDS\_PRACTICE} = 30.00$
  - $\text{MAX\_SCORE\_NEEDS\_PRACTICE} = 35.00$
  - $\text{DECLINING\_NEEDS\_PRACTICE\_SCORE} = 50.00$
  - $\text{MIN\_CONFIDENCE\_ASSESSED} = 25.00$
  - $\text{SCORE\_STABLE\_MIN} = 40.00$, $\text{SCORE\_STABLE\_MAX} = 65.00$
- **Decision Hierarchy:**
  1. $\text{Attempted} = 0 \land \text{Solved} = 0 \implies \text{'UNASSESSED'}$.
  2. $\text{Confidence} < 25.00 \implies \text{'DEVELOPING'}$ (safeguards against single-solve false positives/negatives).
  3. $\text{Score} \ge 65.00 \land \text{Confidence} \ge 45.00 \land \text{Trend} \ne \text{'declining'} \implies \text{'STRENGTH'}$.
  4. $\text{HasStruggleEvidence} \land (\text{Score} < 35.00 \lor (\text{Score} < 50.00 \land \text{Trend} = \text{'declining'})) \land \text{Confidence} \ge 30.00 \implies \text{'NEEDS\_PRACTICE'}$.
  5. $40.00 \le \text{Score} < 65.00 \land \text{Confidence} \ge 30.00 \land \text{Trend} = \text{'stable'} \implies \text{'STABLE'}$.
  6. Fallback $\implies \text{'DEVELOPING'}$.

### 3. User-Level Aggregation & Summary Breakdown
- `SkillCalculationService.buildSkillClassificationSummary` generates user-level derived aggregations:
  - `strengthsCount`, `needsPracticeCount`, `developingCount`, `stableCount`, `unassessedCount`
  - Grouped arrays: `strengths`, `needsPractice`, `developing`, `stable`, `unassessed`.

### 4. Database Persistence & API Integration
- `user_skills.classification` and `user_skill_history.classification` stored as `VARCHAR(30) NOT NULL DEFAULT 'UNASSESSED'`.
- Index: `idx_user_skills_classification`.
- Authenticated endpoints `/api/skills/my` and `/api/users/me/skills` return full classification breakdowns and summary.
- Public views `/api/skills/user/:idOrUsername` expose public classification metadata while shielding private raw scores.

### 5. Automated Test Suite (`test_phase5_7_5_skills.js`)
- 31/31 automated assertions passing across all 20 required classification, threshold, multi-topic, submission hook, and API privacy scenarios.

---

## 9.10 Phase 5.7.6 — Profile & Dashboard Skill Visualization

### 1. Frontend Component Architecture
- **[`SkillCard.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SkillCard.jsx)**: Reusable, accessible presentation card displaying topic name, category, proficiency level, score (out of 100 with progress meter), classification status, confidence rating (High / Medium / Low), and deterministic trend (`↑ Improving`, `→ Stable`, `↓ Declining`).
- **[`SkillProgressChart.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SkillProgressChart.jsx)**: Pure responsive SVG chart visualizing score curves over historical snapshots with area gradient fill, interactive hover tooltips, time-range controls (Recent 10 / All History), and natural-language screen-reader live region summaries (`aria-live="polite"`).
- **[`SkillDetailModal.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SkillDetailModal.jsx)**: Focused dialog providing topic breakdown, embedded SVG chart, evidence counters, and full historical snapshots table with keyboard Escape navigation.
- **[`SkillsOverviewMatrix.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SkillsOverviewMatrix.jsx)**: Complete skills dashboard and profile view featuring KPI summary counters (`strengths`, `needsPractice`, `developing`, `stable`, `total`), classification filter tabs, real-time search, responsive card grid, empty states, and loading skeletons.
- **[`DashboardSkillsWidget.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/DashboardSkillsWidget.jsx)**: Compact overview widget integrated directly into `StudentDashboard.jsx` highlighting top confirmed strengths and priority focus areas.

### 2. Strict Server-Authoritative Integrity
- Zero client-side arithmetic or metric recalculation: `skillScore`, `confidence`, `evidence`, `trends`, and `classifications` are strictly consumed from backend API payloads (`/api/skills/my` and `/api/skills/my/history/:topicKey`).
- Public profile requests (`/api/skills/user/:idOrUsername`) strictly hide private raw scores while preserving public level tiers and classification categories.

### 3. Design System & Theme Integration
- Uses CSS design tokens (`--bg-surface`, `--bg-panel`, `--accent-primary`, `--accent-cyan`, `--radius-lg`) ensuring 100% harmonious rendering in both Dark and Light themes.
- WCAG compliant color-contrast distinctions with accompanying icons and textual labels for all status indicators (no information communicated solely by color).

### 4. Automated Verification Suite (`test_phase5_7_6_skills_ui.js`)
- 32/32 assertions passing across static architecture audits, backend API integration, privacy scoping, empty states, and theme styling.

---

## 9.11 Phase 5.7.7 — Optimization, Full Testing & Final Readiness

### 1. Architectural Optimizations & N+1 Query Elimination
- **Windowed PostgreSQL Query Optimization:** Refactored `UserSkillHistoryModel.getUserOverallTrends(userId)` from an $O(N)$ sequential per-topic query loop to a single $O(1)$ window query utilizing `ROW_NUMBER() OVER (PARTITION BY ush.topic_id ORDER BY ush.recorded_at DESC, ush.id DESC)` filtered to `rn <= 2`. This reduces database roundtrips from $N+1$ to 1 single fast query, dropping overall trend derivation latency to sub-5ms.
- **Concurrent Recalculation:** Updated `SkillCalculationService.recalculateAllUserSkills` to process topic recalculations concurrently with `Promise.all`.
- **Compound Index Coverage:** Added index `idx_user_skill_history_lookup` on `user_skill_history(user_id, topic_id, recorded_at DESC, id DESC)` for instant deduplication checks and timeline queries.
- **Input Validation & Date Parsing Hardening:** Enforced strict parameter bounds (`MAX_QUERY_LIMIT = 100`) and graceful handling of malformed ISO date query strings without database runtime exceptions.

### 2. Comprehensive Hardening & Latency Verification (`test_phase5_7_7_optimization.js`)
- 29/29 automated assertions verifying:
  1. Strict scoring & confidence bounds $[0.00, 100.00]$ with NaN/Infinity numerical safety.
  2. Snapshot duplicate write suppression for identical recalculations.
  3. Windowed query equivalence against individual topic trends.
  4. Stability threshold delta boundaries ($\pm 1.00$ point).
  5. Low-confidence safeguards preventing premature `STRENGTH` or `NEEDS_PRACTICE` designations.
  6. Sub-50ms query and calculation latencies.
  7. SQL injection resistance and mass assignment protection on user skill tables.

### 3. Full Platform Regression Status
- **Backend Regression (19/19 Suites Passed):** 100% test pass rate across Auth, Contests, Judge, Sandboxing, Anti-Cheat, Anti-Hardcoding, API Security, and all 6 Skill engine suites.
- **Frontend Regression (9/9 Suites Passed):** 100% pass rate across Navigation, Auth, Dashboard, Submissions, Rating, Profile, Standings, Leaderboard, and Skill UI Visualization.
- **Production Bundle:** Built cleanly via `npm run build` in 1.36s with 0 errors.
- **Platform Grand Total:** **902 / 902 Automated Tests Passing (100%)**.

---

## 9.12 Phase 5.8.1 — Submission Detail + Full Code Architecture

### 1. Architectural Scope & Objective
Phase 5.8.1 establishes the foundational layer for Submission Performance Analytics by providing a secure, comprehensive Submission Detail page and API endpoint (`GET /api/submissions/:id`). The view displays the exact historical submitted source code stored immutably in PostgreSQL, authoritative judge verdicts, runtime and memory metrics, multi-tier validation stage breakdowns, contest context, and diagnostic compiler output.

### 2. Backend Submission Detail API & Security Enforcement
- **Strict Server-Side BOLA / IDOR Defense:**
  - Students are authorized to inspect only their own submissions (`submission.userId === req.user.id`). Unauthorized student requests return `403 Forbidden` without leaking metadata or source code.
  - Contest creators and problem owners (Professors/Admins) are authorized to inspect student submissions for contests/problems they administer.
  - Unauthenticated requests return `401 Unauthorized`.
- **Strict Numeric ID Validation & SQL Injection Resistance:**
  - Enforced regular expression validation `/^\d+$/` on submission ID parameters in both `getSubmissionById` and `getSubmissionCode`, rejecting malformed strings (`abc`), SQL injection attempts (`1 OR 1=1`), and negative numbers with `400 Bad Request`.
- **Data Payload Serialization:**
  - Returns: `id`, `userId`, `username`, `userFullName`, `contestId`, `contestTitle`, `problemId`, `problemTitle`, `problemDifficulty`, `language`, `codingMode`, `sourceCode` (exact byte-for-byte historical code), `status`, `score`, `executionTime`, `memoryUsed`, `errorMessage`, `testCasesPassed`, `testCasesTotal`, `validationSummary`, `createdAt`.
  - Sensitive internal data (password hashes, judge worker internal keys) are strictly shielded.

### 3. Frontend Read-Only Code Viewer & Submission Detail View
- **[`SubmissionDetail.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SubmissionDetail.jsx):**
  - **Hero Header:** Displays Submission ID, Problem Title, Difficulty pill, Contest link/badge, submitted timestamp, and a high-visibility Verdict Hero Badge with non-color-only icons and textual labels (`Accepted`, `Wrong Answer`, `Time Limit Exceeded`, `Memory Limit Exceeded`, `Compilation Error`, `Runtime Error`).
  - **Performance Metrics Grid:** 6 structured cards displaying Score (`/ 100 pts`), Runtime (`ms`), Memory (`KB/MB`), Test Cases passed (`X / Y passed`), Language tag, and Execution Mode tag.
  - **Multi-Tier Validation Pipeline Breakdown:** Visual chips for Standard, Random, Edge, and Boundary stages with pass/fail counts when `validationSummary` is present.
  - **Diagnostic Output Console:** Sanitized terminal console for compiler or exception errors.
  - **Read-Only Code Viewer:** Embedded Monaco Editor configured with `readOnly: true`, `domReadOnly: true`, language-aware syntax highlighting (C++, Python, Java, JavaScript, Plaintext), line numbers, and active Theme awareness (Dark / Light).
  - **Copy Code Action:** Clipboard copy button with accessible confirmation tooltip and toast state.
  - **Interactive Navigation:** "Open in Workspace Editor" to reload code into the IDE, and "Back to Submissions" navigation.
  - **State Handling:** Loading skeletons, 404 Not Found, 403 Forbidden, and missing source code fallback.
- **Routing & Navigation (`App.jsx` & `SubmissionHistory.jsx`):**
  - Added URL route `/submissions/:submissionId` with browser history synchronization (`popstate` and `pushState`).
  - Wired submission table rows in `SubmissionHistory.jsx` to navigate to `/submissions/:id`.

### 4. Automated Verification & Regression
- **Backend Suite (`test_phase5_8_1_submissions.js`):** 28/28 assertions passing (exact code immutability, BOLA/IDOR, RBAC, 400/404 handling, SQLi defense).
- **Frontend Suite (`test_phase5_8_1_submission_detail_ui.js`):** 24/24 assertions passing (component static checks, Monaco read-only config, theme tokens, route integration).

---

## 9.14 Phase 5.8.2 — Runtime + Memory Statistics

### 1. Architectural Overview & Objective
Phase 5.8.2 establishes a high-performance, authoritative Submission Performance Statistics layer. It enables authorized students and professors to understand how an individual submission performs relative to all accepted solutions on the same problem and language without computing percentiles (5.8.3), distribution charts (5.8.4), or multi-submission comparisons (5.8.5).

### 2. Backend Database Aggregation & Performance Service
- **Database-Side Aggregation (`SubmissionModel.getProblemPerformanceStats`):**
  - Executes single-query aggregate metrics directly in PostgreSQL using `COUNT`, `MIN`, `MAX`, `AVG`, and `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ...)`:
    - Filters: `problem_id = $1 AND LOWER(language) = LOWER($2) AND status = 'accepted' AND is_sample_run = false AND execution_time IS NOT NULL AND memory_used IS NOT NULL`.
    - Eliminates loading entire submission tables into application memory.
    - PostgreSQL's native `PERCENTILE_CONT(0.5)` computes exact continuous medians for both odd and even sample sizes.
- **Service Layer (`SubmissionPerformanceService.js`):**
  - Resolves target submission performance metrics (`runtimeMs`, `memoryKb`).
  - Normalizes aggregate runtime (Min, Median, Average, Max in ms) and memory (Min, Median, Average, Max in KB).
  - Handles edge states: 0 samples, 1 sample, missing/null target metrics, and non-numeric values.
  - Returns structured comparison scope (`problemId`, `language`, `acceptedOnly: true`, `sampleRunsExcluded: true`).
- **API Controller Integration (`submissionController.js`):**
  - In `getSubmissionById`, computes and embeds `performanceStats` in the 200 OK JSON response without mutating or breaking existing payload keys.
  - Strict BOLA/IDOR authorization ensures students cannot inspect other students' statistics and professors can inspect submissions for owned contests/problems.

### 3. Frontend Performance Benchmark Visualization
- **[`SubmissionDetail.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SubmissionDetail.jsx):**
  - **Performance Benchmark Card (`.submission-perf-stats-card`):** Renders immediately below the Multi-Tier Validation Pipeline Breakdown.
  - **Scope Comparison Badge:** Displays `Compared with X accepted {LANGUAGE} submissions`.
  - **Side-by-Side Comparative Grid:**
    - **Execution Runtime Column:** Target solution runtime (`ms`) vs Min, Median (50th %), Average, and Max.
    - **Memory Utilization Column:** Target solution memory (`KB/MB`) vs Min, Median (50th %), Average, and Max.
  - **Empty / Zero-Sample State:** Clean fallback state ("Performance statistics are not available yet. No accepted submissions have been recorded for this language on this problem.").
  - **Dark / Light Theme Styling:** Fully styled in `index.css` with responsive mobile layout adjustments (`grid-template-columns: 1fr` at 768px).

### 4. Automated Verification & Test Results
- **Backend Suite (`test_phase5_8_2_statistics.js`):** 51/51 assertions passing.
- **Frontend Suite (`test_phase5_8_2_statistics_ui.js`):** 18/18 assertions passing.

---

## 9.15 Master Correction & Platform Hardening Implementation

### 1. Executive Summary & Problem Scope
The Master Correction & Platform Hardening update established a rigorous **PUBLIC vs CONTEST-PRIVATE content model** (HackerRank-style), eliminated workspace control button duplication, resolved page scroll container trapping, and hardened contest lifecycle execution constraints across the entire platform.

### 2. Architectural Deliverables & Security Controls
1. **Content Scope Enforcement (`access_scope`):**
   - Added `access_scope VARCHAR(30) NOT NULL DEFAULT 'public' CHECK (access_scope IN ('public', 'contest_private', 'class', 'institution'))` in PostgreSQL.
   - Indexed via `idx_problems_access_scope`.
   - **Problem Explorer Scoping (`findAllProblems` / `countAllProblems`):** Normal students and guests only see public problems (`access_scope = 'public'`). Private professor contest problems are strictly shielded from public problem exploration, counts, category filters, and search queries.
   - **BOLA/IDOR Direct ID Lookup Protection (`GET /api/problems/:id`):** Enforces server-side authorization check (`isUserAuthorizedForProblem`). If an unauthorized student attempts to fetch a private contest problem, the endpoint returns `404 Not Found` (safe resource disclosure, preventing problem existence leaks). Enrolled contest participants, owning professors, and platform admins receive full problem access.
2. **Workspace Run / Submit Button Consolidation:**
   - Consolidated all workspace actions into [`WorkspaceTopBar.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/navigation/WorkspaceTopBar.jsx) as the single authoritative, responsive control bar.
   - Eliminated the redundant second toolbar inside [`EditorPane.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/EditorPane.jsx), replacing it with a sleek, compact status strip (Mode tag, lines count, ready state).
   - Added contest runtime status locking (`upcoming` contest locks Run/Submit with clear tooltip explanation).
3. **Viewport & Page Scrolling Resolution:**
   - Implemented `.page-viewport-scrollable` in [`index.css`](file:///c:/ary/SecureExamPlatform/frontend/src/index.css) with `overflow-y: auto; height: calc(100vh - 48px); -webkit-overflow-scrolling: touch;`.
   - Guaranteed full, smooth vertical scrollability across all views (Submission Detail, Problem Explorer, Dashboard, Rankings).
4. **Contest Lifecycle & Test Fixture Pruning:**
   - Ensured `StudentDashboard.jsx` strictly isolates "Live & Running Contests" (`runtimeState === 'running'`) from "Upcoming Contests" (`runtimeState === 'upcoming'`).
   - Fixed `getGuaranteedContestId` in `App.jsx` to prioritize running contests for open practice runs.
   - Automated startup pruning in `initDb.js` to clean up ephemeral test fixture contests without altering demo or user datasets.

### 3. Automated Verification Results
- **Backend Security & Scoping Suite (`test_master_correction_security.js`):** 27/27 assertions passing (100%).
- **Frontend UI & Architecture Suite (`test_master_correction_ui.js`):** 17/17 assertions passing (100%).
- **Platform Grand Total:** **1,067 / 1,067 Automated Tests Passing (100%)**.

---

## 9.16 Phase 5.8.3 — Percentile & Relative Performance Engine

### 1. Executive Summary & Objective
Phase 5.8.3 implements authoritative, percentile-based relative performance analytics for accepted solutions. The engine computes exactly how a student's solution compares against the population of eligible solutions on the same problem and language (*e.g.*, *"Faster than 94.2% of C++ submissions"* and *"Lower than 87.6% of C++ submissions"*), while enforcing strict mathematical determinism, stable tie handling, small dataset protection, language isolation, and public/private contest scoping.

### 2. Mathematical Definition & Algorithmic Rules
- **Runtime Percentile Formula:**
  $$\text{Percentile}_{\text{runtime}} = \text{round}\left(\frac{\text{Count}(\text{eligible accepted submissions with execution\_time} > R)}{\text{Total eligible accepted submissions}} \times 100, 2\right)$$
- **Memory Percentile Formula:**
  $$\text{Percentile}_{\text{memory}} = \text{round}\left(\frac{\text{Count}(\text{eligible accepted submissions with memory\_used} > M)}{\text{Total eligible accepted submissions}} \times 100, 2\right)$$
- **Direction:** Lower is better for both runtime and memory.
- **Deterministic Tie Handling:** Submissions with identical values are counted as equal (not slower/higher). The proportion is strictly deterministic with zero random jitter or floating-point artifacts.
- **Small Dataset Protection:** If eligible population $N < \text{minSampleSize}$ (configured at 5), the engine safely returns:
  `{ "available": false, "reason": "insufficient_data" }`
  and the frontend displays `"Not enough data"` without rendering misleading estimated percentiles.
- **Language & Problem Isolation:** All metrics are strictly partitioned by `(problem_id, LOWER(language))`. C++, Python, and Java are never cross-compared.
- **Public vs Contest Isolation:** Public practice submissions (`contest_id IS NULL`) are evaluated solely against public practice populations; contest submissions are scoped to their respective contest context.

### 3. Architecture & Service Layer
- **Model Layer ([`SubmissionModel.js`](file:///c:/ary/SecureExamPlatform/backend/src/models/submissionModel.js)):**
  - Enhanced `getProblemPerformanceStats` and `getSubmissionPercentileCounts` to accept optional `contestId` filtering using PostgreSQL database-side `FILTER (WHERE ...)` counts.
  - Zero population rows loaded into application memory ($O(1)$ Node.js heap overhead).
- **Service Layer ([`SubmissionPerformanceService.js`](file:///c:/ary/SecureExamPlatform/backend/src/services/submissionPerformanceService.js)):**
  - Implemented `calculatePercentile`, `getRuntimePercentile`, `getMemoryPercentile`, and `getRelativePerformance`.
  - Formats output conforming to Section 14 specifications with `value`, `unit`, `percentile`, `population`, `language`, `comparisonDirection: 'lower_is_better'`, and `available`.
- **API Controller & Routes ([`submissionController.js`](file:///c:/ary/SecureExamPlatform/backend/src/controllers/submissionController.js) & [`submissionRoutes.js`](file:///c:/ary/SecureExamPlatform/backend/src/routes/submissionRoutes.js)):**
  - Added dedicated endpoint: `GET /api/submissions/:id/performance` with `mediumProtectionRateLimiter`.
  - Strict numeric ID regex check (`/^\d+$/`) returning 400 Bad Request on malformed inputs or SQLi payloads.
  - BOLA / IDOR ownership validation: students can only inspect their own submissions (403 Forbidden); professors can inspect submissions for owned contests/problems.
- **Frontend UI Integration ([`SubmissionDetail.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SubmissionDetail.jsx)):**
  - Updated Performance Benchmark cards to display exact wording:
    - *"Faster than X% of {LANGUAGE} submissions"*
    - *"Lower than Y% of {LANGUAGE} submissions"*
    - *"Population: N accepted submissions"*
    - *"Not enough data"* fallback when under threshold or ineligible.

### 4. Database Query Scaling Benchmarks
Database-side count aggregation was verified with PostgreSQL across population scales from 10 to 100,000 submissions:
- **10 submissions:** Total Latency: 6.39 ms | Node Heap: 7.06 MB | Heap Delta: < 0.05 MB
- **1,000 submissions:** Total Latency: 8.73 ms | Node Heap: 7.10 MB | Heap Delta: < 0.05 MB
- **10,000 submissions:** Total Latency: 36.04 ms | Node Heap: 7.19 MB | Heap Delta: < 0.05 MB
- **100,000 submissions:** Total Latency: 333.57 ms | Node Heap: 7.26 MB | Heap Delta: < 0.05 MB

### 5. Automated Verification Results
- **Backend Suite ([`test_phase5_8_3_percentiles.js`](file:///c:/ary/SecureExamPlatform/backend/test_phase5_8_3_percentiles.js)):** 69 / 69 passing assertions (100%).
- **Frontend Suite ([`test_phase5_8_3_percentiles_ui.js`](file:///c:/ary/SecureExamPlatform/frontend/test_phase5_8_3_percentiles_ui.js)):** 15 / 15 passing assertions (100%).
- **Backend Fast Regression:** 11 / 11 suites passed in 29.28s.
- **Frontend Fast Regression:** 9 / 9 suites passed in 4.76s.

---

## 9.17 Phase 5.8.4 — Runtime & Memory Distribution Engine

### 1. Overview & Objectives
Phase 5.8.4 implements a secure, high-performance runtime and memory distribution/histogram engine. It computes aggregated bucket frequency distributions across accepted solutions for the same problem and programming language, allowing students to visualize where their solution lands in the overall performance spectrum.

### 2. Distribution Bucket Strategy
- **Contiguous Non-Overlapping Integer Boundaries:**
  - Every bucket $[B_{\min, i}, B_{\max, i}]$ satisfies $B_{\min, i} \le v \le B_{\max, i}$.
  - For each consecutive pair, $B_{\min, i+1} = B_{\max, i} + 1$.
  - Zero gaps between buckets; zero overlaps.
  - $B_{\min, 0} = V_{\min}$; $B_{\max, \text{last}} = V_{\max}$.
- **Outlier Detection & Overflow Bucket:**
  - If $V_{\max} > \text{median} \times 3.5$ and $V_{\max} > V_{\min} + 50$, an outlier threshold $P_{\text{cap}} = \max(V_{\min} + 20, \text{round}(\text{median} \times 3.0))$ is established.
  - Normal buckets span $[V_{\min}, P_{\text{cap}}]$, and an explicit overflow bucket $[P_{\text{cap}} + 1, V_{\max}]$ is created and labeled `">${P_{\text{cap}}} ${unit}"`.
- **Edge Cases:**
  - Identical values ($V_{\min} = V_{\max}$): Generates a single bucket $[V, V]$ labeled `"${V} ${unit}"` containing 100% of the population.
  - Narrow spans: Subdivided into 1-unit wide buckets without fractional step distortion.
- **Strict Population Reconciliation:**
  - $\sum_{i} \text{count}_i = N_{\text{eligible}}$. Every eligible submission belongs to exactly one bucket.

### 3. Architecture & Service Layer
- **Model Layer ([`submissionModel.js`](file:///c:/ary/SecureExamPlatform/backend/src/models/submissionModel.js)):**
  - Added `getDistributionBucketCounts(problemId, language, runtimeBuckets, memoryBuckets, contestId)`:
    - Synthesizes a single parameterized PostgreSQL query with dynamic `COUNT(*) FILTER (WHERE ...)` clauses for all runtime and memory buckets simultaneously.
    - Strict public vs private contest isolation (`AND contest_id IS NULL` for practice; `AND contest_id = $id` for contests).
    - Zero submission rows loaded into application memory ($O(1)$ constant Node.js heap overhead).
- **Service Layer ([`submissionPerformanceService.js`](file:///c:/ary/SecureExamPlatform/backend/src/services/submissionPerformanceService.js)):**
  - Implemented `generateBucketRanges` and `getPerformanceDistribution`.
  - Enforces minimum sample threshold ($N \ge 5$); returns `{ available: false, reason: 'insufficient_data' }` for smaller populations.
  - Computes exact bucket percentages, identifies user bucket index, and formats human-friendly labels (including MB formatting for memory).
- **Controller & Routes ([`submissionController.js`](file:///c:/ary/SecureExamPlatform/backend/src/controllers/submissionController.js) & [`submissionRoutes.js`](file:///c:/ary/SecureExamPlatform/backend/src/routes/submissionRoutes.js)):**
  - Added endpoint `GET /api/submissions/:id/performance/distribution` protected by `mediumProtectionRateLimiter`.
  - Strict numeric ID regex (`/^\d+$/`) returning 400 Bad Request on invalid format or SQLi payloads.
  - BOLA / IDOR ownership validation: students restricted to own submissions (403); professors authorized for owned problems/contests; unauthenticated blocked (401).
- **Frontend UI & Styling ([`SubmissionDetail.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SubmissionDetail.jsx) & [`index.css`](file:///c:/ary/SecureExamPlatform/frontend/src/index.css)):**
  - Non-blocking asynchronous lifecycle: distribution loads independently without delaying or hiding primary submission verdict.
  - Dual histogram cards: Runtime Distribution and Memory Distribution.
  - Horizontal progress tracks with proportional fill widths, exact count badges, and percentage breakdowns.
  - Accentuated user bucket highlighting with `← You` pill, neon glow, and accessible `aria-label` screen reader announcements.
  - Clean fallbacks for loading skeleton, insufficient data, and network errors.
  - Fully responsive mobile breakpoint (`@media (max-width: 768px)`) preserving page scrolling behavior.

### 4. Database Query Scaling Benchmarks
Database aggregate query latency and Node.js heap consumption were benchmarked across population scales from 10 to 100,000 submissions:
- **10 submissions:** Total Latency: 10.21 ms | Node Heap: 7.05 MB | Heap Delta: < 0.05 MB (O(1))
- **1,000 submissions:** Total Latency: 9.42 ms | Node Heap: 7.23 MB | Heap Delta: < 0.05 MB (O(1))
- **10,000 submissions:** Total Latency: 34.00 ms | Node Heap: 7.33 MB | Heap Delta: < 0.05 MB (O(1))
- **100,000 submissions:** Total Latency: 342.14 ms | Node Heap: 7.41 MB | Heap Delta: < 0.05 MB (O(1))

### 5. Automated Verification Results
- **Backend Test Suite ([`test_phase5_8_4_distribution.js`](file:///c:/ary/SecureExamPlatform/backend/test_phase5_8_4_distribution.js)):** 46 / 46 passing assertions (100%).
- **Frontend Test Suite ([`test_phase5_8_4_distribution_ui.js`](file:///c:/ary/SecureExamPlatform/frontend/test_phase5_8_4_distribution_ui.js)):** 23 / 23 passing assertions (100%).
- **Full Backend Regression Suite:** 24 / 24 suites passed in 72.46s (100%).
- **Full Frontend Regression Suite:** 14 / 14 suites passed in 27.05s (100%).
- **Production Build:** `vite build` completed cleanly in 841ms.

---

## 9.18 Phase 5.8.5 — Submission Comparison Engine

### 1. Architectural Architecture & Core Security Isolation
Phase 5.8.5 implements a secure, side-by-side **Submission Comparison Engine** allowing authorized users (students comparing their own attempts, professors evaluating participants in their contests, and platform administrators) to compare two submissions while strictly separating metadata inspection permissions from source-code access permissions:
- **Independent Authorization Model:**
  - Metadata inspection permission and source-code viewing permission are determined and enforced independently by the backend.
  - The comparison endpoint (`GET /api/submissions/compare?left=<id>&right=<id>`) returns comparison metrics and an explicit authorization map (`sourceCode: { leftVisible: boolean, rightVisible: boolean }`) without ever exposing raw source code in the comparison payload.
  - Authorized clients retrieve source code on demand via the existing hardened endpoint (`GET /api/submissions/:id/code`).
- **Student Privacy & BOLA Defense:**
  - Students are strictly restricted to comparing submissions they own. Attempting to pair an owned submission with an unowned submission or comparing another student's submission returns `403 Forbidden` without leaking metadata.
- **Professor Contest Scoping:**
  - Professors can compare submissions belonging to contests or problems they own, or their own submissions.
  - Cross-owner contest access between professors is strictly prohibited (`403 Forbidden`).
- **Same-Problem Strict Validation:**
  - Both submissions must belong to the exact same problem (`left.problemId === right.problemId`). Cross-problem requests are rejected with `400 Bad Request`.
- **Language Isolation & Honest Benchmarking:**
  - Identical languages (`C++` vs `C++`): direct delta computation for runtime (`runtimeDifference`) and memory (`memoryDifference`), accompanied by clear text summaries (e.g. "Submission A is 16 ms faster", "Submission A uses 6 MB less memory").
  - Different languages (`C++` vs `Python`): raw values are displayed alongside their language badges, but numeric differences are set to `null` with a clear explanation that cross-language execution speeds cannot be directly compared.
- **Graceful Non-Execution Handling:**
  - Non-accepted verdicts (`compilation_error`, `runtime_error`, `system_error`) or missing metrics display "Unavailable" instead of misleading zero values.

### 2. API Endpoints
- `GET /api/submissions/compare?left=<id>&right=<id>`: Protected by `mediumProtectionRateLimiter` and JWT authentication. Performs server-authoritative independent verification and returns comparison metadata and source code permission flags.
- `GET /api/submissions/problem/:problemId/my`: Returns recent candidate submissions for the given problem belonging to the authenticated user for the comparison selection dropdown.

### 3. Frontend Comparison Experience
- **Interactive Modal Component ([`SubmissionComparisonModal.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SubmissionComparisonModal.jsx)):**
  - Side-by-side 3-column table on desktop; clean stacked card layout on mobile (`@media (max-width: 768px)`).
  - Candidate dropdown selectors for Submission A and Submission B with automatic pre-selection of candidate pairs.
  - Executive summary card highlighting runtime and memory differences with accessible text labels.
  - Comprehensive comparison matrix: Verdict, Language & Mode, Runtime, Memory, Test Cases Passed, and Submission Date.
  - Source Code inspection: "View Code" action buttons are rendered only when authorized (`leftVisible` / `rightVisible`), with private locked pills displayed when unauthorized.
- **Unified Navigation Integration:**
  - Added "Compare" button to [`SubmissionDetail.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SubmissionDetail.jsx) action bar.
  - Added "Compare" quick action button to each submission row in [`SubmissionHistory.jsx`](file:///c:/ary/SecureExamPlatform/frontend/src/components/SubmissionHistory.jsx).

---

## 10. Testing Suggestions & Roadmap for Future Development Phases

To ensure long-term architectural stability, high performance, and bug prevention in upcoming phases, the following testing practices are recommended:

### 10.1 Automated Regression Testing
1. **Consolidated Full-Run Command:** Run `npm test` in both `backend/` and `frontend/` before completing any future development phase.
2. **Database Test Isolation:** Always use uniquely timestamped identifiers (`ts = Date.now()`) for test users, contests, and problems to prevent data collision between test runs.
3. **Transaction Rollback Testing:** For administrative workflows (e.g. contest finalization, balance updates), verify that database errors trigger proper `ROLLBACK` and leave user balances / ratings untainted.

### 10.2 Frontend & UI Testing Suggestions
1. **Responsive Viewport Assertions:** Test components across mobile (375px), tablet (768px), and desktop (1440px) breakpoints to ensure zero horizontal scroll overflow.
2. **Theme Switching Parity:** Validate that custom SVG components (such as the rating graph, Code Core emblem, and breakdown rings) adapt their stroke and fill colors dynamically when toggling between light and dark themes.
3. **State Restoration Verification:** Verify that page navigation preserves filter and search query parameters in the URL so that users can bookmark and share specific views.

### 10.3 Performance & Load Testing
1. **Concurrent Contest Finalization:** Test rating finalization with large participant pools ($N \ge 100$) to verify pairwise Elo calculation performance ($O(N^2)$) remains well under 100ms.
2. **Index Optimization:** Ensure database indexes (`idx_submissions_contest_user_status`, `idx_rating_history_user_id`, `idx_rating_history_contest_id`, `idx_users_current_rating`, `idx_users_rating_desc_id_asc`, `idx_users_institution`) are verified via `EXPLAIN ANALYZE` on large datasets.
