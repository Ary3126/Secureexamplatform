# Phase 4 Comprehensive Engineering Report: Online Judge, Enhanced Validation & Security Hardening Architecture

**Platform**: Secure Competitive Programming & Examination Platform  
**Status**: Fully Completed, Hardened & Stabilized (100% Automated Test Suite Passing — 331/331 Tests)  
**Includes**:
* **Phase 4A**: Standard Online Judge Sandbox Engine (C++, Java, Python)
* **Phase 4A Extra**: Dual-Mode Function Harness, Student Dashboard, User Profiles
* **Phase 4B.1**: Validation Architecture & Problem Test Configuration Model/APIs
* **Phase 4B.2**: Deterministic Randomized Test Generation & Trusted Oracle Framework
* **Phase 4B.3**: Edge-Case & Boundary-Case Generation with Cross-Suite Deduplication
* **Phase 4B.4**: Anti-Hardcoding & Suspicious Solution Detection (Static & Behavioral Analysis)
* **Phase 4B.5**: Enhanced Judge Orchestration, State Machine, Early Stopping & Verdict Integration
* **Phase 4B.6**: Judge Security Hardening, Resource Defense, Queue Backpressure & Adversarial Protection
* **Phase 4B.7**: Multi-Language Parity, Concurrency Stress, Failure Recovery & Platform Stabilization

---

## 1. Executive Summary

Phase 4 delivers an end-to-end sandboxed online judge and validation platform with multilayered security defense, resource isolation, abuse mitigation, deterministic evaluation guarantees, and high-concurrency throughput.

The evaluation infrastructure features:
1. **Container Security & Capability Stripping**: Strict `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, and separate CPU/memory/process caps across both compilation and test execution.
2. **Fail-Closed Execution Policy**: Pre-execution invariant enforcement via `SecurityPreconditions` rejecting path traversal, oversized payloads (>64 KB), invalid languages, and missing environment bounds prior to launching processes.
3. **Multi-Language Function Mode Parity**: Seamless, unified evaluation semantics across Python 3.12, C++17, and Java 17 under standard competitive-programming function harnesses (`class Solution`).
4. **Defense Against Hostile Resource Exhaustion**:
   - **Infinite CPU Loops**: Terminated by process-tree treekill and mapped to `TIME_LIMIT_EXCEEDED`.
   - **Memory Exhaustion**: Enforced by container/JVM limits (`-Xmx256m`) and memory sampling.
   - **Fork Bombs & Process Spawning**: Capped via `--pids-limit 64` (and `100` during compilation) with recursive process-tree termination.
   - **Output Stream Floods**: Both `stdout` and `stderr` streams are strictly truncated and capped at `512 KB`, terminating the process and preventing host disk exhaustion.
   - **Source Code Size Flood**: Submissions exceeding `64 KB` are rejected with `400 Bad Request`.
5. **Queue Abuse & Backpressure Protection**:
   - Queue capacity capped at `500` concurrent/queued jobs to prevent memory depletion.
   - Active submission deduplication preventing concurrent duplicate evaluations.
   - Sliding-window rate limiting middleware on `/api/submissions` and `/api/submissions/run` with `429 Too Many Requests`.
6. **Sanitized Process Environment & Secret Protection**:
   - Host environment variables (`DATABASE_URL`, `JWT_SECRET`, `POSTGRES_PASSWORD`, etc.) are stripped; only minimal safe variables (`PATH`, `TEMP`, `TMP`, `PYTHONUNBUFFERED`, `PYTHONDONTWRITEBYTECODE`) are provided.
   - Sensitive database fields and passwords are automatically redacted from all audit and security logs.
7. **Workspace Hygiene & Isolated Cleanup**:
   - Workspace directories are constructed under isolated subpaths within OS temp space and unlinked in `finally` blocks under both normal and abnormal exit conditions.

---

## 2. End-to-End Orchestrated & Hardened Pipeline

```
Student Code Submission
         │
         ▼
[ SecurityPreconditions & RateLimiter Check ]
 ├── Rate Limit < 10 req / 10s?
 ├── Source Code Size <= 64 KB?
 └── Safe Workspace Path & Allowed Language?
         │ (PASS)
         ▼
[ JudgeQueue Concurrency & Backpressure Guard ]
 ├── Queue Capacity <= 500?
 └── Idempotency Guard (Not currently running)?
         │
         ▼
┌───────────────────────────────────────────────────────────┐
│              Hardened ValidationRun Pipeline               │
│                                                           │
│  [ Stage 1: COMPILATION (Sandbox / Capability Stripped) ] │
│  ├── --network none, --cap-drop ALL, --pids-limit 100     │
│  └── FAIL? ──► [ Early Stop: COMPILATION_ERROR ]          │
│                                                           │
│  [ Stage 2: STANDARD TESTS (Visible & Hidden) ]           │
│  ├── Max Output 512KB, Memory & CPU Limits                │
│  └── FAIL? ──► [ Early Stop: WRONG_ANSWER / TLE / RTE ]   │
│                                                           │
│  [ Stage 3: RANDOM VALIDATION (Deterministic PRNG) ]      │
│  ├── Seeded Mulberry32, Bounded Test Count (<= 50)        │
│  ├── Trusted Oracle computes expected output              │
│  └── FAIL? ──► [ Early Stop: WRONG_ANSWER ]               │
│                                                           │
│  [ Stage 4: EDGE-CASE VALIDATION ]                        │
│  ├── Extreme mathematical edge inputs (0, ±1, min, max)   │
│  └── FAIL? ──► [ Early Stop: WRONG_ANSWER ]               │
│                                                           │
│  [ Stage 5: BOUNDARY-CASE VALIDATION ]                    │
│  ├── Bounded domain limits & structural array combinations│
│  └── FAIL? ──► [ Early Stop: WRONG_ANSWER ]               │
│                                                           │
│  [ Stage 6: SUSPICION ANALYSIS ]                          │
│  ├── AST-free source scan + Known-vs-Unknown Discrepancy  │
│  └── Suspicion classification (LOW / MEDIUM / HIGH)       │
│                                                           │
│  [ Stage 7: ADDITIONAL VALIDATION (If HIGH Suspicion) ]   │
│  ├── Secondary dynamic verification in sandbox            │
│  └── Verified Clean ──► Downgrade / Fail ──► Flagged      │
│                                                           │
│  [ Stage 8: FINALIZATION & AUDIT PERSISTENCE ]            │
│  ├── Deterministic Verdict Priority Calculation           │
│  ├── Write submission_validation_runs audit record        │
│  └── Finally: Clean up workspace & process trees          │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
                [ Final Verdict Result ]
```

---

## 3. Subsystem Breakdown

### A. Phase 4A — Core Standard Online Judge
* **Multi-Language Isolated Runners**:
  * **Python 3.12**: Sandboxed process runner with memory & execution timeout guards.
  * **C++ (GCC 16.2)**: Strict `-O2 -std=c++17 -Wall` compilation with binary execution sandbox.
  * **Java 17 (Microsoft OpenJDK)**: Bytecode compilation and memory-capped JVM execution (`-Xmx256m`).
* **Evaluation & Verdict Engine**:
  * `ACCEPTED`, `WRONG_ANSWER`, `COMPILATION_ERROR`, `RUNTIME_ERROR`, `TIME_LIMIT_EXCEEDED`, `MEMORY_LIMIT_EXCEEDED`, `SYSTEM_ERROR`.
* **Output Comparator**: Normalizes Windows/Unix line endings (`\r\n` vs `\n`) and trailing whitespace while strictly verifying standard output.

---

### B. Phase 4A Extra Features
1. **LeetCode-Style Function Mode**:
   * Server-controlled execution harness wrapping untrusted student `class Solution { ... }` methods.
   * Dynamic Java reflection and C++ templates allowing flexible method signatures without compile-time breakage.
2. **Student Dashboard & Live Metrics**:
   * Live countdown timers for running contests.
   * Real-time query of distinct problems solved, registered contests, and submission history.
3. **User Profile & Identity System**:
   * Custom bios, avatar URLs, non-sensitive statistics (contests joined, problems solved).
   * Strict privacy filtering: Password hashes and private email addresses are omitted from public profile endpoints.

---

### C. Phase 4B.1 — Validation Architecture & Problem Configuration
* **Database Entity (`problem_validation_configs`)**:
  * `problem_id` (Unique foreign key referencing `problems(id)` with `ON DELETE CASCADE`).
  * `validation_enabled`, `random_enabled`, `edge_enabled`, `boundary_enabled` (Boolean flags).
  * `random_test_count` (Integer constrained between `1` and `50` to prevent resource exhaustion).
  * `generator_type` (`integer`, `integer_array`, `range_generator`, `array_generator`, etc.).
  * `generator_config`, `reference_solution`, and `validation_metadata` (JSONB).
* **RESTful Problem Validation APIs**:
  * `GET /api/problems/:problemId/validation-config`: Retrieve configuration.
  * `POST / PUT /api/problems/:problemId/validation-config`: Upsert configuration (Problem owner or Admin).
  * `DELETE /api/problems/:problemId/validation-config`: Reset configuration to defaults.

---

### D. Phase 4B.2 — Deterministic Randomized Test Generation & Trusted Oracle
1. **Deterministic PRNG (`prng.js`)**:
   * Implements Mulberry32 pseudo-random number generator initialized via cryptographic SHA-256 hash of `(problemId, submissionId, testIndex, salt)`.
   * Given identical parameters, generates 100% reproducible byte-for-byte identical test inputs.
   * Internal seeds are never exposed to students in submission responses.
2. **Platform-Controlled Trusted Oracle (`trustedOracle.js`)**:
   * Computes verified expected output without executing untrusted student code.
   * Supports sandboxed execution of professor reference solutions or platform-trusted algorithmic oracles (`sum`, `product`, `sort`, `max`, `min`).
   * If the oracle fails or crashes, records a safe internal validation error without marking student code as `WRONG_ANSWER`.

---

### E. Phase 4B.3 — Edge-Case & Boundary-Case Validation Engine
1. **Integer Edge & Boundary Strategies (`integerGenerator.js`)**:
   * **Edge Values**: Generates $\min, \min+1, -1, 0, 1, \max-1, \max$, and high-value pairs $[(\min, \max), (\max, \min), (0, 0), (-1, 1)]$.
   * **Boundary Values**: Extreme domain limits $[(\min, \min), (\max, \max), (\min, \max), (0, \min), (0, \max)]$.
   * **Constraint Enforcement**: Strictly checks configured ranges (e.g. negative numbers are omitted when $\min \ge 0$).
2. **Integer Array Edge & Boundary Strategies (`integerArrayGenerator.js`)**:
   * **Structural Edge Cases**: Single-element arrays, minimum size arrays, all-zero arrays, all-duplicate values, alternating values $[(\min, \max, \min, \dots)]$, one extreme value among zeros, sorted ascending, and sorted descending.
   * **Boundary Cases**: Minimum size + all min values, minimum size + all max values, maximum size (capped safely to 2,000 elements) + all min values, maximum size + all max values, and maximum size + alternating boundary values.
3. **Cross-Suite Deduplication**:
   * Generates normalized SHA-256 fingerprint for all inputs.
   * Automatically skips redundant executions if an edge or boundary case was already executed in standard or random suites.
4. **Hard Resource Limits**:
   * `MAX_RANDOM_TESTS: 50`
   * `MAX_EDGE_TESTS: 20`
   * `MAX_BOUNDARY_TESTS: 20`
   * `MAX_TOTAL_VALIDATION_TESTS: 70`
   * `MAX_GENERATED_INPUT_BYTES: 256 KB`
   * `MAX_TOTAL_GENERATED_BYTES: 5 MB`

---

### F. Phase 4B.4 — Anti-Hardcoding & Suspicious Solution Detection
1. **Static Analysis Signals (`staticAnalyzer.js`)**:
   * **Signal A — Excessive Exact-Input Branching (+25 pts)**: Identifies chained `if/elif` statements with exact equality comparisons against known test input constants.
   * **Signal B — Hardcoded Output Mapping (+35 pts)**: Identifies dictionary/map literals matching test input-output pairs.
   * **Signal C — High Constant Correlation (+20 pts)**: Detects when numeric literals in source code correlate heavily with problem test cases.
2. **Behavioral Generalization Signals (`behavioralAnalyzer.js`)**:
   * **Signal D — Known vs Unknown Discrepancy (+40 pts)**: Flags submissions that achieve 100% pass on known standard tests but fail on dynamically generated unseen validation tests.
3. **Suspicion Scoring Engine (`suspicionScorer.js`)**:
   * **Classification**:
     * `LOW` (0–29): Normal competitive-programming solution.
     * `MEDIUM` (30–59): Notable patterns; standard verdict preserved.
     * `HIGH` (60–100): Suspicious test-memorization; internally flagged for audit.
   * **Core Principle**: Suspicion score alone never alters an `ACCEPTED` verdict unless the solution fails concrete validation tests in the sandbox.
4. **False-Positive Mitigation**:
   * Standard competitive-programming constants (`MOD = 1000000007`, `998244353`, `INF = 2147483647`) and legitimate base-case conditionals (`if (n <= 1) return 1`) are explicitly excluded from suspicion weighting.
   * If static analysis indicates HIGH suspicion, the judge conducts up to 5 additional unseen randomized tests in the sandbox. If the submission passes all of them, the suspicion level is downgraded.

---

### G. Phase 4B.5 — Enhanced Judge Orchestration & Verdict Integration
1. **`ValidationRun` State Machine (`validationRun.js`)**:
   * Encapsulates the complete lifecycle and stage transitions with sub-millisecond duration timing.
   * Deterministically enforces verdict precedence so lower-priority states cannot overwrite higher-priority errors.
2. **Early Stopping Engine**:
   * Halts downstream execution immediately when a hard failure occurs (compilation, standard test, random test, edge test, or boundary test), preventing wasteful sandbox execution.
3. **Database Audit Table (`submission_validation_runs`)**:
   * Stores stage metrics, durations, failure stages, suspicion scores, and audit flags linked directly to `submissions.id`.
4. **Queue Concurrency & Idempotency Guards (`judgeQueue.js`)**:
   * In-memory active submission tracking guarantees duplicate queue jobs for the same submission ID are ignored.
5. **Infrastructure Error Isolation**:
   * Host system exceptions, sandbox initialization errors, and oracle failures cleanly trigger `SYSTEM_ERROR` without penalizing students.

---

### H. Phase 4B.6 — Security Hardening & Abuse Protection
1. **Fail-Closed Policy (`securityPreconditions.js`)**:
   * Validates parameter invariant ranges, language allowlists, and directory boundaries prior to any process spawn.
2. **Docker Hardening (`dockerRunner.js`)**:
   * Added `--cap-drop ALL`, `--security-opt no-new-privileges`, compilation memory bounds (`512m`), compilation PID bounds (`100`), and strict `--network none`.
3. **Queue Backpressure Defense**:
   * Caps queue depth at `500` entries to prevent unbounded memory consumption.
4. **Submission Rate Limiter (`submissionRateLimiter.js`)**:
   * Sliding window limiter returning `429 Too Many Requests` on rapid spam bursts.
5. **Security Audit Logger (`securityLogger.js`)**:
   * Redacts sensitive secrets, passwords, and tokens from all audit trails.

---

### I. Phase 4B.7 — Stabilization, Multi-User Stress & Benchmarks
1. **Multi-User Isolation Under Attack**:
   * Verified that concurrent submissions from multiple users (e.g. Student A executing an infinite loop while Student B submits a valid solution) execute in total isolation without starvation or cross-contamination.
2. **Performance Benchmarks**:
   * **Python 3.12**: ~1,209 ms total evaluation duration | ~67 MB memory footprint.
   * **C++17 (GCC 16.2)**: ~1,321 ms total evaluation duration (including compilation) | ~68 MB memory footprint.
   * **Java 17 (OpenJDK)**: ~1,458 ms total evaluation duration (including javac + JVM) | ~64 MB memory footprint.
3. **Database Referential Integrity**:
   * Verified cascade-delete mechanics, run metric recording, and schema consistency across all validation tables.

---

## 4. Phase Roadmap & Milestones

| Phase | Focus Area | Status |
| :--- | :--- | :--- |
| **Phase 4A** | Standard Online Judge Engine (C++, Java, Python) | **Completed** |
| **Phase 4A Extra** | Function Mode Harness, Student Dashboard, User Profiles | **Completed** |
| **Phase 4B.1** | Validation Architecture & Problem Configuration | **Completed** |
| **Phase 4B.2** | Deterministic Randomized Test Generation & Oracle | **Completed** |
| **Phase 4B.3** | Edge-Case & Boundary-Case Generation with Deduplication | **Completed** |
| **Phase 4B.4** | Anti-Hardcoding & Solution Integrity Analysis | **Completed** |
| **Phase 4B.5** | Enhanced Judge Pipeline Orchestration & Verdict Integration | **Completed** |
| **Phase 4B.6** | Security Hardening, Resource Defense & Abuse Protection | **Completed** |
| **Phase 4B.7** | Stabilization, Multi-Language Parity & Load Benchmarks | **Completed** |
| **Phase 5** | Live Contests, Rating & Leaderboards | Deferred |
| **Phase 6** | Professor / Admin Management Frontend & Lockdown | Deferred |

---

## 5. Automated Verification & Full Regression Results

| Test Suite | Target Component | Tests Passed | Pass Rate |
| :--- | :--- | :---: | :---: |
| `test_phase2.js` | RBAC, JWT Auth & Security Middleware | 28 / 28 | 100% |
| `test_phase3.js` | Contests, Problems & Test Case Bank | 32 / 32 | 100% |
| `test_phase4a.js` | Sandboxed Judge, Runners & Isolation | 36 / 36 | 100% |
| `test_phase4a_extra.js` | Function Harness, Dashboard & Profile APIs | 40 / 40 | 100% |
| `test_phase4b1.js` | Validation Architecture & Config Model/APIs | 46 / 46 | 100% |
| `test_phase4b2.js` | Deterministic Generators, Oracle & Fuzzing | 30 / 30 | 100% |
| `test_phase4b3.js` | Edge & Boundary Generation, Deduplication | 29 / 29 | 100% |
| `test_phase4b4.js` | Anti-Hardcoding & Suspicion Analysis Engine | 24 / 24 | 100% |
| `test_phase4b5.js` | State Machine, Early Stopping & Orchestration | 33 / 33 | 100% |
| `test_phase4b6_security.js` | Judge Security Hardening & Adversarial Attacks | 12 / 12 | 100% |
| `test_phase4b7_stabilization.js` | Multi-Language Parity, Concurrency Stress & Recovery | 21 / 21 | 100% |
| **TOTAL** | **Full Platform Regression** | **331 / 331** | **100%** |