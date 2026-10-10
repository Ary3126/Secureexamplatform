# Phase 4A Implementation Report — Standard Online Judge

**Secure Competitive Programming & Examination Platform**  
**Phase:** Phase 4A (Standard Online Judge)  
**Date:** August 15, 2026  
**Status:** Completed & 100% Verified (36 Automated Tests Passed)

---

## 1. Executive Summary

Phase 4A establishes the core **Standard Online Judge** subsystem for the Secure Examination Platform. Untrusted student-submitted code is isolated from the host backend, compiled and executed with strict resource and security bounds, evaluated against visible and hidden test cases, and assigned verified verdicts.

Key features completed in Phase 4A:
- Multi-language extensible runner architecture (`C++`, `Python`, `Java`).
- Dual-mode execution engine: Sandboxed Process Isolation + Docker Container Isolation (`--network none`, non-root execution, cgroups resource caps).
- Relational tables for `test_cases` and `submissions` with foreign keys and indexes.
- Problem test-case management APIs with strict role-based access control (RBAC).
- Complete isolation between "Run" (sample test cases) and "Submit" (official hidden test cases).
- Decoupled asynchronous submission queue and worker pool with concurrency control.
- React + Monaco Editor split-pane contest coding workspace.

---

## 2. Database Schema & Tables

### 2.1 `test_cases` Table
```sql
CREATE TABLE IF NOT EXISTS test_cases (
    id SERIAL PRIMARY KEY,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    input_data TEXT NOT NULL DEFAULT '',
    expected_output TEXT NOT NULL DEFAULT '',
    is_hidden BOOLEAN NOT NULL DEFAULT true,
    time_limit_ms INTEGER NOT NULL DEFAULT 2000 CHECK (time_limit_ms > 0),
    memory_limit_mb INTEGER NOT NULL DEFAULT 256 CHECK (memory_limit_mb > 0),
    test_order INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 `submissions` Table
```sql
CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    language VARCHAR(30) NOT NULL CHECK (language IN ('cpp', 'python', 'java')),
    source_code TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN (
        'queued', 'running', 'accepted', 'wrong_answer',
        'compilation_error', 'runtime_error', 'time_limit_exceeded',
        'memory_limit_exceeded', 'system_error'
    )),
    score INTEGER DEFAULT 0,
    execution_time INTEGER DEFAULT 0,
    memory_used INTEGER DEFAULT 0,
    error_message TEXT,
    is_sample_run BOOLEAN NOT NULL DEFAULT false,
    test_cases_passed INTEGER NOT NULL DEFAULT 0,
    test_cases_total INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Backend APIs (Phase 4A)

| Endpoint | Method | Auth | Role | Description |
|---|---|---|---|---|
| `/api/problems/:problemId/test-cases` | `POST` | Yes | `professor`+ | Add test case to problem |
| `/api/problems/:problemId/test-cases` | `GET` | Yes | `professor`+ | List all test cases (administrative) |
| `/api/test-cases/:id` | `PUT` | Yes | `professor`+ | Update test case (owner protected) |
| `/api/test-cases/:id` | `DELETE` | Yes | `professor`+ | Delete test case (owner protected) |
| `/api/submissions` | `POST` | Yes | `student`+ | Submit official solution (queued evaluation) |
| `/api/submissions/run` | `POST` | Yes | `student`+ | Run code interactively against sample test cases |
| `/api/submissions/my` | `GET` | Yes | `student`+ | View personal submission history |
| `/api/submissions/:id` | `GET` | Yes | `student`+ | Get submission status and metrics |

---

## 4. Sandbox & Execution Security Architecture

1. **Host Isolation:**
   - User code is never executed directly inside the Node.js backend process.
   - Dedicated temporary workspaces (`/tmp/secure_judge/sub_<id>_<uuid>`) are created per execution and destroyed in `finally` blocks.
2. **Environment Variable Sanitization:**
   - The execution process environment is stripped of all application secrets (`PGUSER`, `PGPASSWORD`, `DATABASE_URL`, `JWT_SECRET`, `.env`).
   - Verified by automated exploit test cases in `test_phase4a.js`.
3. **Hard Resource Limits:**
   - Wall-clock / CPU time limits (e.g. 2000 ms) with process group termination.
   - Standard output stream cap (512 KB) to prevent infinite print memory exhaustion.
   - Peak memory measurement.
4. **Docker Container Runner:**
   - Production Docker isolation using `--network none`, `--memory`, `--cpus`, `--pids-limit`, and non-root execution (`judgeuser`).

---

## 5. Judge Verdict Engine

Verdicts computed by the Judge Service:
- `ACCEPTED`: All test cases passed with matching normalized output.
- `WRONG_ANSWER`: Output mismatch on test case.
- `COMPILATION_ERROR`: Syntax / compilation error with sanitized compiler diagnostic.
- `RUNTIME_ERROR`: Process crashed or exited with non-zero code (e.g. ZeroDivisionError).
- `TIME_LIMIT_EXCEEDED`: Process execution exceeded configured time limit.
- `MEMORY_LIMIT_EXCEEDED`: Process memory exceeded configured memory limit.
- `SYSTEM_ERROR`: Sandbox execution or judge worker failure.

---

## 6. Frontend Coding Workspace (React + Monaco Editor)

The frontend client in `frontend/` provides:
- Split-pane layout: Problem statement on left, Monaco Editor on right.
- Language switcher: `C++ (GCC 17)`, `Python 3.12`, `Java 17`.
- Live contest countdown timer synced with server end-time.
- Interactive "Run" tab: displays input, expected output, and actual user output per sample test case.
- Official "Submit" tab: displays verdict banner, score, execution time, memory used, and error diagnostics.
- Submission history table.

---

## 7. Automated Test Results

Phase 4A Test Suite (`test_phase4a.js`):
- **Total Tests:** 36
- **Passed:** 36
- **Failed:** 0

Overall Platform Suite (`npm test`):
- **Phase 2 (Auth & RBAC):** 28 / 28 Passed
- **Phase 3 (Contests & Problems):** 32 / 32 Passed
- **Phase 4A (Online Judge):** 36 / 36 Passed
- **Total System Tests:** 96 / 96 Passed (100% Success)

---

## 8. Next Phase: Phase 4B (Planned)

Phase 4B will introduce:
- AI-assisted solution validation and anti-hardcoding heuristics.
- Property-based randomized testcase generation.
- Dynamic evaluation pipeline insertion after standard tests pass.