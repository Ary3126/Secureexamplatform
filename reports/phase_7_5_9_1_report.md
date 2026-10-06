# Phase 7.5.9.1 — Rating Management Architecture & Audit Report

**Date:** 2026-10-04  
**Author:** ExamForge Technical Lead & Senior Software Engineer  
**Status:** READY FOR 7.5.9.2  
**Parent Phase:** 7.5.9 — Rating Management  

---

## 1. Executive Summary

Phase 7.5.9.1 performed a comprehensive architectural, algorithmic, database, security, integrity, performance, and frontend audit of the competitive rating system in ExamForge. The rating system implements an authoritative multi-participant Elo algorithm that calculates deterministic rating adjustments for participants upon contest conclusion and finalization.

During the audit, two architectural/integrity weaknesses were identified and fixed:
1. **Full-Scale Participant Standings Truncation:** `RatingService.computeContestStandings` previously called `StandingsService.computeContestStandings` without `isExport: true` or `limit: 'all'`. Because `StandingsService` clamps numeric `limit` values to a maximum of 100 participants per page, contests with more than 100 participants would have only calculated rating deltas for the first 100 participants. This was corrected by passing `isExport: true, limit: 'all'`, guaranteeing unconstrained, full-roster rating calculations.
2. **User Rating Parameter Validation & Error Handling:** The user rating endpoints (`GET /api/users/:id/rating` and `GET /api/users/:id/rating-history`) did not validate whether `id` was a positive integer or `'me'`, allowing non-integer inputs like `'abc'` to reach PostgreSQL as `NaN` and crash with an unhandled 500 database error. Furthermore, non-existent user IDs returned empty history instead of a proper 404. These endpoints now validate positive integer inputs (returning 400 Bad Request) and verify user existence (returning 404 Not Found).

A dedicated test suite (`backend/test_phase7_5_9_1_rating_architecture_audit.js`) was created, achieving **57/57 passing assertions** across all functional, algorithmic, integrity, and security boundaries. Full regression tests (`test_phase7_5_8_9_integration_completion.js`) and frontend production builds confirmed zero breakage across the existing platform.

---

## 2. Existing Rating Architecture

ExamForge's competitive rating architecture operates as follows:

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        A[Professor / Admin Dashboard]
        B[Public / Student Contest Results]
        C[Student Profile & Identity]
    end

    subgraph API ["REST API Layer"]
        D["POST /api/contests/:id/finalize-ratings<br/>(authorizeRoles + RateLimiter)"]
        E["GET /api/contests/:id/results<br/>(Public / Protected)"]
        F["GET /api/users/:id/rating & rating-history<br/>(Protected)"]
    end

    subgraph Controller ["Contest & User Controllers"]
        G[contestController.finalizeContestRatings]
        H[userController.getUserRating]
    end

    subgraph Services ["Core Services"]
        I[RatingService.finalizeContestRatings]
        J[StandingsService.computeContestStandings]
        K[AuditLogger.logAction]
    end

    subgraph DB ["PostgreSQL (ACID Transaction)"]
        L[Row Lock: SELECT FOR UPDATE]
        M[Idempotency & Pending Checks]
        N[Calculate Pairwise Elo Deltas]
        O[UPDATE users]
        P[INSERT INTO rating_history ON CONFLICT DO NOTHING]
        Q[UPDATE contests is_rating_finalized & snapshot]
    end

    A --> D
    B --> E
    C --> F
    D --> G
    F --> H
    G --> I
    I --> L --> M --> J --> N --> O --> P --> Q --> K
```

### Key Components:
- **`backend/src/services/ratingService.js`**: Core Elo mathematical calculations, standing resolution, and transactional finalization orchestrator.
- **`backend/src/models/ratingModel.js`**: Database persistence layer for `rating_history`, user rating updates, user rating summaries, and deterministic global rank calculation.
- **`backend/src/config/ratingConfig.js`**: Centralized rating parameters (initial rating: 1200, provisional threshold: 5 contests, provisional $K=64$, rated $K=32$, floor: 100, 6 rating tiers).
- **`backend/src/services/standingsService.js`**: Authoritative scoreboard engine that attaches official rating changes from `rating_history` when `contest.is_rating_finalized = true`.
- **`backend/src/controllers/contestController.js`**: Handles finalization requests with RBAC and contest manager ownership validation.
- **`backend/src/controllers/userController.js`**: Serves user rating profiles and historical rating logs.

---

## 3. Existing Rating Algorithm

The rating system uses a **Deterministic Pairwise Multi-Participant Elo Algorithm** modeled after competitive programming benchmarks (Codeforces, TopCoder, AtCoder):

### 3.1 Pairwise Expected Score
For each participant $i$ in a contest with $N$ participants, a virtual head-to-head match is evaluated against every other opponent $j$:
$$E_{ij} = \frac{1}{1 + 10^{\frac{R_j - R_i}{400}}}$$

Expected score satisfies symmetry: $E_{ij} + E_{ji} = 1.0$.

### 3.2 Actual Score Based on Authoritative Rank
The actual match outcome $S_{ij}$ is determined strictly by the participant's official rank from `StandingsService`:
$$S_{ij} = \begin{cases} 
1.0 & \text{if } \text{rank}_i < \text{rank}_j \text{ (Win)} \\
0.5 & \text{if } \text{rank}_i = \text{rank}_j \text{ (Tie)} \\
0.0 & \text{if } \text{rank}_i > \text{rank}_j \text{ (Loss)}
\end{cases}$$

Actual score satisfies symmetry: $S_{ij} + S_{ji} = 1.0$.

### 3.3 Dynamic Volatility (K-Factor)
To accelerate rating calibration for new participants while preserving stability for veterans:
- **Provisional ($K=64$):** When `ratedContestCount < 5`. Rating moves twice as fast to find true placement.
- **Established ($K=32$):** When `ratedContestCount >= 5`. Normal competitive calibration.

### 3.4 Normalized Rating Delta
The net rating change $\Delta R_i$ is normalized by the number of opponents ($N - 1$):
$$\Delta R_i = \text{round}\left( \frac{K_i}{N - 1} \sum_{j \neq i} (S_{ij} - E_{ij}) \right)$$

- **Zero-Sum Property:** When all participants share equal K-factors, $\sum_{i=1}^N \Delta R_i = 0$ (modulo integer rounding), preventing systemic rating inflation or deflation.
- **Single-Participant Edge Case ($N=1$):** Delta is strictly 0. Participant's rated contest count increments, but rating remains unchanged.
- **Ties:** Tied participants split points evenly ($S_{ij} = 0.5$), resulting in symmetric, zero-bias distribution.
- **Rating Floor:** $R_{\text{new}} = \max(100, R_{\text{previous}} + \Delta R_i)$.
- **Peak Rating Tracking:** $R_{\text{peak}} = \max(R_{\text{highest}}, R_{\text{new}})$.
- **Performance Rating:** Approximated as $R_i + \frac{\sum S_{ij} - \frac{N-1}{2}}{N-1} \times 400$.

---

## 4. Data Model Audit

### 4.1 Schema Definition & Relationships
- **`users` Table:**
  - `current_rating INTEGER NOT NULL DEFAULT 1200`
  - `highest_rating INTEGER NOT NULL DEFAULT 1200`
  - `rating_status VARCHAR(20) NOT NULL DEFAULT 'provisional' CHECK (rating_status IN ('provisional', 'rated'))`
  - `rated_contest_count INTEGER NOT NULL DEFAULT 0`
  - *Indexes:* `idx_users_current_rating ON users(current_rating DESC)`, `idx_users_rating_desc_id_asc ON users(current_rating DESC, id ASC)`, `idx_users_rating_status ON users(rating_status)`.
- **`contests` Table:**
  - `is_rated BOOLEAN NOT NULL DEFAULT true`
  - `is_rating_finalized BOOLEAN NOT NULL DEFAULT false`
  - `ratings_finalized_at TIMESTAMP WITH TIME ZONE`
  - `final_results_snapshot JSONB DEFAULT NULL`
- **`rating_history` Table:**
  - `id SERIAL PRIMARY KEY`
  - `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE`
  - `previous_rating INTEGER NOT NULL`
  - `rating_change INTEGER NOT NULL`
  - `new_rating INTEGER NOT NULL`
  - `rank INTEGER NOT NULL`
  - `participant_count INTEGER NOT NULL`
  - `performance_rating INTEGER NOT NULL DEFAULT 1200`
  - `rating_status VARCHAR(20) NOT NULL DEFAULT 'provisional'`
  - `created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
  - *Unique Constraint:* `CONSTRAINT uq_rating_history_user_contest UNIQUE (user_id, contest_id)`
  - *Indexes:* `idx_rating_history_user_id`, `idx_rating_history_contest_id`, `idx_rating_history_created_at`.

### 4.2 Data Integrity & Duplicate Prevention
1. **Database Constraint:** `uq_rating_history_user_contest` prevents duplicate entries per user per contest at the storage engine level.
2. **Query Level:** `RatingModel.createRatingHistoryEntry` uses `INSERT ... ON CONFLICT (user_id, contest_id) DO NOTHING`.
3. **Transaction Level:** `SELECT * FROM contests WHERE id = $1 FOR UPDATE` locks the contest row, serializing concurrent requests and evaluating `is_rating_finalized` before any write operations occur.

---

## 5. API & Endpoints Audit

| Method | Endpoint | Authorization | Description | Audit Status |
|---|---|---|---|---|
| `POST` | `/api/contests/:id/finalize-ratings` | `professor`, `contest_admin`, `super_admin` | Finalizes contest, calculates Elo, updates users, writes snapshot | Verified (ACID, Idempotent) |
| `POST` | `/api/contests/:id/finalize` | `professor`, `contest_admin`, `super_admin` | Alias for `finalize-ratings` | Verified |
| `GET` | `/api/users/:id/rating` | Authenticated | Returns current rating, peak, status, contest count, global rank | Fixed ID validation |
| `GET` | `/api/users/:id/rating-history` | Authenticated | Returns chronological history of rating adjustments | Fixed ID validation & 404 |
| `GET` | `/api/users/me/identity` | Authenticated | Aggregates rating core, SVG curve points, and badges | Verified |
| `GET` | `/api/contests/:id/leaderboard` | Public / Protected | Live/frozen/final standings with attached rating deltas | Verified |
| `GET` | `/api/contests/:id/results` | Public / Protected | Authoritative sealed results view with rating delta badges | Verified |
| `GET` | `/api/contests/:id/participants/:userId/results` | Student self / Manager | Detailed participant results with rating changes | Verified |
| `GET` | `/api/contests/:id/export/results` | Manager only | CSV/JSON export with rating changes | Verified |

---

## 6. Frontend Integration Audit

Inspected existing UI components that render competitive ratings:
1. **`UserProfile.jsx`**:
   - Renders SVG Elo rating progression chart with tooltips, historical curve, and empty states ("Participate in rated contests...").
   - Displays Primary Competitive Rating Hero Card with tier badge, provisional status indicator, peak rating, and global rank.
   - Chronological table of contest rating adjustments with color-coded tags (`+` green, `-` red).
   - Reads server-authoritative data from `/api/users/me/identity`.
2. **`ContestResultsView.jsx`**:
   - Displays "Official Contest Results & Rating Adjustments Finalized" banner when `contest.isRatingFinalized = true`.
   - Displays podium delta pills for 1st, 2nd, and 3rd place.
   - Displays participant's individual rating adjustment and new rating.
   - Includes `Δ Rating` table column showing official rating changes.
3. **`GlobalLeaderboard.jsx`**:
   - Renders platform-wide competitive rankings based on `current_rating`.
   - Displays tier badges (Elite, Master, Specialist, Expert, Challenger, Explorer).
4. **`CoderEmblem.jsx`**:
   - Renders tier-colored emblems and user avatars.

---

## 7. Security & Authorization Findings

1. **Role-Based Access Control (RBAC):** Students are strictly blocked from invoking finalization endpoints (`POST /api/contests/:id/finalize-ratings` returns 403 Forbidden).
2. **BOLA / IDOR Protection:** Non-owning professors attempting to finalize another professor's contest are rejected with 403 Forbidden via `canManageResource(req.user, contest)`.
3. **Result Immutability:** Once `is_rating_finalized = true`, attempts to mutate `isRated`, `leaderboardFreezeEnabled`, or `leaderboardFreezeMinutes` via contest update APIs are rejected with 409 Conflict.
4. **No Client Trust:** Client cannot submit rating deltas, scores, or ranks. Standings are computed authoritatively on the backend from judge submission records.
5. **Fixed Gap — Parameter Validation on User Rating Endpoints:**
   - Previously: `parseInt(req.params.id, 10)` allowed strings like `'abc'` to become `NaN`, resulting in `SELECT ... WHERE id = NaN`, throwing unhandled 500 database errors.
   - Fix: Added strict positive integer validation returning 400 Bad Request on invalid format, and 404 Not Found if the user does not exist.

---

## 8. Integrity & Idempotency Findings

1. **ACID Finalization Boundaries:** `RatingService.finalizeContestRatings` wraps all operations in a single database transaction (`BEGIN ... COMMIT / ROLLBACK`).
2. **Concurrent Finalization Protection:** `SELECT * FROM contests WHERE id = $1 FOR UPDATE` serializes concurrent finalization calls.
3. **Order of Operations:** The idempotency check (`if (contest.is_rating_finalized) return alreadyFinalized: true`) executes first under the row lock, ensuring no duplicate calculation or rating inflation occurs even on repeated requests.
4. **Pending Submissions Guard:** Checks for submissions with `status IN ('queued', 'running')` and aborts with 409 Conflict unless `force: true` is explicitly provided.
5. **Unrated Contests:** Properly bypasses rating updates while sealing official standings and results snapshot.
6. **Fixed Gap — Full Standings Scale in Rating Calculation:**
   - Previously: `RatingService.computeContestStandings` did not pass `isExport: true` or `limit: 'all'`, causing `StandingsService` pagination to clamp participants to 100.
   - Fix: Updated to pass `isExport: true, limit: 'all'`, ensuring all participants in large contests are retrieved for rating calculation.

---

## 9. Performance Findings

1. **Query Efficiency:**
   - Standings calculation avoids N+1 queries by fetching rating history for the entire contest in a single query (`SELECT ... FROM rating_history WHERE contest_id = $1`) and mapping by `userId`.
   - Global rank calculation uses the B-tree index `idx_users_rating_desc_id_asc ON users(current_rating DESC, id ASC)` to count users in under 1ms.
2. **Scalability Assessment for 1,000 Concurrent Users:**
   - Pairwise Elo calculation runs in memory in $O(N^2)$. For $N=1,000$, $1,000 \times 1,000 = 1,000,000$ simple floating-point operations take ~4-8ms in Node.js.
   - For database persistence of 1,000 participants, the current sequential loop executes 2 queries per participant (2,000 queries in total). While acceptable for post-contest background finalization, batching (`INSERT ... VALUES (...), (...)` and batch `UPDATE ... FROM ...`) will further optimize performance.

---

## 10. Audit Fixes Implemented

### Fix 1: Unconstrained Standings Retrieval for Rating Calculations
- **File:** `backend/src/services/ratingService.js`
- **Change:** Updated `computeContestStandings` to pass `isExport: true, limit: 'all'` and return `result._allParticipants || result.standings || []`.
- **Impact:** Prevents rating calculation from truncating after 100 participants in contests with large participation.

### Fix 2: User Rating Parameter Format Validation & 404 Guard
- **File:** `backend/src/controllers/userController.js`
- **Change:** Added strict validation in `getUserRating` and `getUserRatingHistory` checking that `id` is `'me'` or a valid positive integer string. Added explicit check for user existence returning 404 Not Found.
- **Impact:** Eliminates unhandled 500 PostgreSQL errors on invalid user IDs and prevents silent empty responses for non-existent users.

---

## 11. Test Coverage & Verification

### Dedicated Phase 7.5.9.1 Test Suite
- **File:** `backend/test_phase7_5_9_1_rating_architecture_audit.js`
- **Total Assertions:** 57
- **Passed:** 57
- **Failed:** 0
- **Coverage Areas:**
  - Elo calculation math (wins, losses, ties, K-factors: 64 vs 32).
  - Single-participant edge case ($\Delta R = 0$).
  - Symmetric zero-sum conservation.
  - Rating floor enforcement ($MIN\_RATING = 100$).
  - Mathematical determinism (identical runs yield identical deltas).
  - Database schema, unique constraints (`ON CONFLICT DO NOTHING`), and indexes.
  - Transactional finalization and strictly idempotent repeated execution.
  - Unrated contest finalization (snapshot created, zero rating changes).
  - RBAC: student blocked (403), non-owning professor blocked (403).
  - Parameter sanitization: invalid ID returns 400 Bad Request, nonexistent ID returns 404 Not Found.
  - Valid user requests (`/me/rating` and `/:id/rating-history`) return 200 OK.
  - Full-scale participant retrieval verification.
  - Cross-layer consistency: leaderboard, results view, and participant result details all reflect authoritative rating adjustments.

### Regression Test
- **File:** `backend/test_phase7_5_8_9_integration_completion.js`
- **Result:** 27 PASSED, 0 FAILED.
- **Frontend Build:** `npm run build` completed cleanly in 2.22s with zero errors.

---

## 12. Recommended Architecture for Phase 7.5.9.2 Onward

1. **Phase 7.5.9.2 (Rating Calculation & Edge Cases):**
   - Retain current pairwise Elo algorithm as the verified mathematical baseline.
   - Add specialized support for:
     - DNF (Did Not Finish) / unattempted participants handling policies.
     - Outlier calibration (e.g., participants with very high initial provisional swings).
     - Performance rating standard deviations.
2. **Phase 7.5.9.3 (Rating History & Profile Progression):**
   - Timeline sorting: Ensure rating history query orders by contest competition `startTime` rather than finalization timestamp if contests are finalized out of order.
   - Include contest rank percentiles in historical logs.
3. **Phase 7.5.9.4 (Bulk Finalization Optimization):**
   - Optimize step 9 in `finalizeContestRatings` to use batched multi-row inserts and `UPDATE ... FROM (VALUES ...)` to finalize 1,000+ participant contests in under 100ms.
4. **Phase 7.5.9.5 (Administrative Recalculation & Rollback Tooling):**
   - Provide an administrative recalculation utility with rollback capabilities in the rare event of contest invalidation or score corrections.

---

## 13. Known Issues

None. All audited components are verified, data integrity is confirmed, and identified edge-case bugs have been resolved and tested.

---

## 14. Final Readiness Decision

```
================================================================
                    FINAL READINESS DECISION                    
================================================================
 Status: READY FOR 7.5.9.2
 Verification: 57/57 Phase 7.5.9.1 assertions PASSED
 Regression: 27/27 Integration tests PASSED, Frontend build CLEAN
 Critical Defects: ZERO
 Unresolved Vulnerabilities: ZERO
================================================================
```
