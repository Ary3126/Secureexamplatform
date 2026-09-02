# Phase 3 Report — Contest Management System

## Project: Secure Competitive Programming & Examination Platform
**Phase:** Phase 3 (Contest Management, Problem Bank, Publishing Lifecycle & Participation)  
**Date:** August 2026  
**Status:** Completed & Ready for Verification  

---

## 1. Overview & Scope

Phase 3 introduces the complete Contest Management backend.

### Scope Delivered:
1. **Database Tables:** `contests`, `problems`, `contest_problems`, and `contest_participants` with relational foreign keys, cascade rules, and check constraints.
2. **Problem Bank Management:** Independent problem creation (`easy`, `medium`, `hard`) with ownership controls.
3. **Contest Management:** Draft contest creation, metadata updates, deletion, and publishing validation (requires title, valid timestamps, and at least 1 attached problem).
4. **Contest-Problem Association:** Multiple problem assignments per contest with custom ordering and points, with duplicate protection (`409 Conflict`).
5. **Dynamic Lifecycle State Engine:** Server-derived runtime state calculation (`DRAFT` ➡️ `UPCOMING` ➡️ `RUNNING` ➡️ `ENDED`) based on system timestamps.
6. **Contest Participation:** Students and users can join published, active contests. Unique constraint prevents duplicate participation.
7. **Resource-Level Authorization (Ownership):** Professors can only update or delete contests/problems they created, while `contest_admin` and `super_admin` hold platform-wide authority.

---

## 2. Database Schema (Phase 3 Tables)

```sql
-- 1. Contests Table
CREATE TABLE IF NOT EXISTS contests (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_contest_times CHECK (end_time > start_time)
);

-- 2. Problems Table
CREATE TABLE IF NOT EXISTS problems (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Contest-Problems Association
CREATE TABLE IF NOT EXISTS contest_problems (
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    problem_order INTEGER NOT NULL DEFAULT 1,
    points INTEGER NOT NULL DEFAULT 100 CHECK (points > 0),
    PRIMARY KEY (contest_id, problem_id)
);

-- 4. Contest Participants
CREATE TABLE IF NOT EXISTS contest_participants (
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, user_id)
);
```

---

## 3. Roles & Permissions Matrix (Contests & Problems)

| Role | Create Problem | Manage Problem (Own / Others) | Create Contest | Manage Contest (Own / Others) | Publish Contest | Join Contest | View Participants |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **`student`** | ❌ (403) | ❌ / ❌ | ❌ (403) | ❌ / ❌ | ❌ (403) | ✅ (Published) | ❌ (403) |
| **`professor`** | ✅ (201) | ✅ Own / ❌ (403) | ✅ (201) | ✅ Own / ❌ (403) | ✅ Own / ❌ (403) | ✅ (Published) | ✅ (Own Contest) |
| **`contest_admin`**| ✅ (201) | ✅ / ✅ | ✅ (201) | ✅ / ✅ | ✅ | ✅ | ✅ |
| **`super_admin`** | ✅ (201) | ✅ / ✅ | ✅ (201) | ✅ / ✅ | ✅ | ✅ | ✅ |

---

## 4. Contest Lifecycle Transitions

```text
       [ CREATE CONTEST ]
               │
               ▼
       status = 'draft' (runtimeState: 'draft')
               │
               ▼ [ POST /api/contests/:id/publish ]
        (Validates times & >= 1 problem attached)
               │
               ▼
       status = 'published'
               ├── now < startTime ───────────► runtimeState: 'upcoming'
               ├── startTime <= now < endTime ─► runtimeState: 'running'
               └── now >= endTime ────────────► runtimeState: 'ended'
```

---

## 5. API Reference & Postman Testing Guide

### Problem Endpoints

1. **Create Problem:**
   * `POST /api/problems`
   * Headers: `Authorization: Bearer <PROFESSOR_OR_ADMIN_TOKEN>`
   * Body:
     ```json
     {
       "title": "Two Sum",
       "description": "Given an array of integers, return indices of the two numbers that add up to target.",
       "difficulty": "easy"
     }
     ```

2. **List Problems:**
   * `GET /api/problems` (Optional query: `?difficulty=easy`)

3. **Get Problem by ID:**
   * `GET /api/problems/:id`

4. **Update Problem:**
   * `PUT /api/problems/:id` (Ownership protected)

5. **Delete Problem:**
   * `DELETE /api/problems/:id` (Ownership protected)

---

### Contest Endpoints

1. **Create Contest (Draft):**
   * `POST /api/contests`
   * Headers: `Authorization: Bearer <PROFESSOR_OR_ADMIN_TOKEN>`
   * Body:
     ```json
     {
       "title": "Weekly Algorithm Contest #1",
       "description": "Official weekly coding contest",
       "startTime": "2026-09-01T10:00:00Z",
       "endTime": "2026-09-01T12:00:00Z"
     }
     ```

2. **Add Problem to Contest:**
   * `POST /api/contests/:id/problems`
   * Body:
     ```json
     {
       "problemId": 1,
       "problemOrder": 1,
       "points": 100
     }
     ```

3. **Publish Contest:**
   * `POST /api/contests/:id/publish`
   * Validates that at least 1 problem is attached before publishing.

4. **List Contests:**
   * `GET /api/contests` (Optional filter: `?state=upcoming`, `?state=running`, `?state=ended`)

5. **Get Contest Details:**
   * `GET /api/contests/:id` (Includes attached problems, problem order, and points)

6. **Join Contest:**
   * `POST /api/contests/:id/join`
   * Allows students/users to join published active contests (prevents duplicate joins).

7. **View Contest Participants:**
   * `GET /api/contests/:id/participants` (Restricted to managers)

8. **Update / Delete Contest:**
   * `PUT /api/contests/:id` / `DELETE /api/contests/:id` (Ownership protected)

---

## 6. How to Run Verification in PowerShell

Open your PowerShell terminal and run:

1. **Apply database schema:**
   ```powershell
   cd c:\ary\SecureExamPlatform\backend
   npm run db:init
   ```

2. **Run Phase 3 Automated Test Suite:**
   ```powershell
   npm run test:phase3
   ```

3. **Run All Platform Tests (Phase 2 + Phase 3):**
   ```powershell
   npm test
   ```
