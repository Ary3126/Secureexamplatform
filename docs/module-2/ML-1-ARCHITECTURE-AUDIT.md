# CODEFROG Module 2 — ML Practical Lab
## Architecture Audit & Foundation Blueprint (Task ML-1)

- **Date:** October 2026
- **Git Branch:** `feature/module-2-foundation`
- **Target Repository:** [https://github.com/Ary3126/Secureexamplatform](https://github.com/Ary3126/Secureexamplatform)
- **Status:** Architectural Audit & Proposal (Pre-Implementation / Non-Destructive)

---

## 1. Executive Summary & Context

Module 1 of the **CODEFROG** platform (SecureExamPlatform) provides a production-grade competitive programming and academic examination engine featuring automated sandboxed code execution, real-time leaderboards, rating calculation (Elo/Glicko), and coder skill analytics.

**Module 2** introduces a **Python / Data Science / Machine Learning Virtual Practical Lab**. This module allows faculty to design structured data science and machine learning assignments, provision curated training and hidden evaluation datasets, and assess student submissions across empirical performance metrics (e.g., Accuracy, F1-Score, RMSE, inference latency, memory consumption) and code quality rubrics.

### Core Architectural Mandates
1. **Zero Degradation of Module 1:** Module 1 examination, contest ratings, problem bank, and judge pipeline must remain unaffected and fully backwards-compatible.
2. **Absolute Rating Isolation:** ML practical lab scores, grades, and completion metrics must **never** mutate competitive programming contest ratings (`users.current_rating`, `users.highest_rating`, `rating_history`).
3. **Execution Safety Boundary:** Student-submitted Python code must **never** execute inside the Express API process.
4. **Prudent Infrastructure Evolution:** Heavy orchestration frameworks such as JupyterHub, DockerSpawner, or Kubernetes operators are evaluated but **deferred** in favor of lightweight, isolated worker execution until proven necessary.
5. **Fail-Closed Security & Secret Shielding:** Hidden evaluation datasets, ground-truth labels, private test cases, and database credentials must remain strictly inaccessible to students and untrusted code.
6. **Feature Flag Controlled:** Module 2 must be safely gate-kept behind feature flags on both backend and frontend so it can remain completely disabled in production environments without impacting active contests.

---

## 2. Existing Architecture Audit & Repository Grounding

### 2.1 Technology Stack & Directory Structure
An inspection of the existing codebase confirms the following technology stack and structural patterns:

```text
SecureExamPlatform/
├── backend/
│   ├── src/
│   │   ├── config/             # Environment (env.js), Pool (db.js), Rate Limit (rateLimitConfig.js), Init (initDb.js)
│   │   ├── controllers/        # Express handlers (auth, contest, problem, submission, admin, etc.)
│   │   ├── database/           # schema.sql (453 lines) & migrations
│   │   ├── judge/              # In-process queue (judgeQueue.js), runners (cpp, java, python, docker), validation
│   │   ├── middleware/         # authMiddleware.js, roleMiddleware.js, rateLimitMiddleware.js, errorHandler.js
│   │   ├── models/             # Parameterized PostgreSQL models (user, contest, problem, submission, rating)
│   │   ├── routes/             # REST routing (index.js mounts /api/*)
│   │   ├── services/           # authService, auditLogger, globalRankingService, ratingService
│   │   └── server.js           # Express app setup, security headers, HPP defense, graceful shutdown
│   ├── scripts/testRunner.js   # Unified benchmark & test execution engine
│   └── test_*.js               # Category suites (unit, feature, judge, security, admin)
│
├── frontend/
│   ├── src/
│   │   ├── components/         # Reusable views (ProblemExplorer, StudentDashboard, AdminPanel, etc.)
│   │   ├── components/navigation/ # AppShell, TopBar, Sidebar, CommandPalette, WorkspaceTopBar
│   │   ├── config/navConfig.js # Declarative sidebar and role navigation groups
│   │   ├── theme/ThemeContext  # Light/Dark dynamic token provider
│   │   ├── App.jsx             # State router & pushState browser history manager
│   │   └── index.css           # Vanilla CSS design tokens, layout utilities, animations
│   ├── scripts/testRunner.js   # Frontend test suite runner
│   └── vite.config.js          # Vite 8.x configuration
```

### 2.2 Key Findings from Repository Files

1. **Backend Routing (`backend/src/routes/index.js` & `server.js`):**
   - All REST APIs are mounted under `/api`.
   - `server.js` applies `helmet` (with strict CSP, frameguard), `cors(corsOptions)`, `requestIdMiddleware`, `metricsMiddleware`, `timeoutMiddleware` (30s default), JSON body parsing (512 KB limit), and deterministic HTTP Parameter Pollution (HPP) defense.
   - `notFoundHandler` and `errorHandler` strictly enforce standard JSON error contracts:
     ```json
     {
       "status": "error",
       "statusCode": 400,
       "error": "CATEGORY_NAME",
       "message": "Human-readable description",
       "requestId": "uuid",
       "timestamp": "ISO8601"
     }
     ```
   - **Safest Integration Point:** Mount a dedicated router `router.use('/ml', mlRoutes)` inside `backend/src/routes/index.js` guarded by an ML feature flag.

2. **Database Engine & Connection Pool (`backend/src/config/db.js` & `initDb.js`):**
   - Utilizes `pg.Pool` with connection pool limits (max 20 clients, 3s connect timeout, 30s idle timeout).
   - Queries are strictly parameterized (`pool.query(text, params)`); transactions use dedicated acquired clients (`getClient()`).
   - `initDb.js` executes idempotent `CREATE TABLE IF NOT EXISTS`, conditional column additions (`DO $$ BEGIN ... END $$;`), constraint checks, index declarations, and loads `backend/src/database/schema.sql`.
   - **Safest Integration Point:** Create dedicated Module 2 migration script and integrate cleanly into `initDb.js` without altering existing table definitions.

3. **Authentication & Role Authorization Middleware:**
   - `authMiddleware.js`:
     - `authenticate`: Extracts `Bearer <token>`, verifies JWT via `jsonwebtoken`, validates integer `userId > 0`, loads user from DB (`UserModel.findUserById`), verifies `user.is_active === true`, and attaches sanitized user object to `req.user`.
     - `optionalAuthenticate`: Gracefully attaches `req.user` if valid, sets `req.user = null` otherwise.
   - `roleMiddleware.js`:
     - `authorizeRoles(...allowedRoles)`: Returns 401 if unauthenticated, 403 if `!allowedRoles.includes(req.user.role)`.
     - Denials are forensically logged to `audit_logs` table via `AuditLogger.logAction` with action `'PRIVILEGED_ACTION_DENIED'`.
   - **Actual Roles in Database (`schema.sql` line 12):**
     `CHECK (role IN ('student', 'professor', 'contest_admin', 'super_admin'))`
   - **Critical Role Finding:** The platform uses `'professor'` as the faculty role. There is **no** separate `'faculty'` role string. To maintain 100% database check constraint and middleware compatibility, Module 2 must use `'professor'` for faculty/instructors, `'student'` for learners, and `'super_admin'` for administrators.

4. **Rate Limiting Architecture (`backend/src/config/rateLimitConfig.js`):**
   - Tiers defined: `AUTH` (10 req/min), `RUN_CODE` (15 req/min), `SUBMIT_CODE` (20 req/min), `CONTEST_ACTION` (30 req/min), `MEDIUM_PROTECTION` (120 req/min), `PUBLIC_READ` (300 req/min), `ADMIN_ACTION` (30 req/min).
   - ML operations will require specific rate limit definitions:
     - `ML_INTERACTIVE_RUN`: 10 req/min (compute heavy).
     - `ML_OFFICIAL_SUBMIT`: 5 req/min (eval heavy).
     - `ML_BROWSE`: 120 req/min (standard reading).

5. **Existing Code Execution Engine (`backend/src/judge/`):**
   - Module 1 execution is designed for short competitive programming solutions (<2-5 seconds, <256 MB memory).
   - `BaseRunner` spawns localized processes (`python solution.py` via `PythonRunner`) or calls `DockerRunner`.
   - `DockerRunner` runs `docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --memory 512m --cpus 1.0 ...` with fallback to native runner when Docker is unreachable.
   - `JudgeQueue` controls in-process concurrency (`concurrency = 2`, max 500 queued jobs, max 2 concurrent jobs per user).
   - **Critical Difference for ML:** ML jobs require 30s to several minutes, heavy libraries (NumPy, PyTorch, Pandas, Scikit-Learn), 1-4 GB RAM, and dataset file mounts. Spawning them inside the native host without container isolation or in-process queue could starve the Express API event loop or exhaust memory.

6. **Frontend State & Navigation (`App.jsx`, `AppShell.jsx`, `navConfig.js`):**
   - `App.jsx` implements client-side routing via `activeView` state and `window.history.pushState`.
   - Sidebar navigation is driven by `NAV_GROUPS` in `frontend/src/config/navConfig.js`. Items specify `allowedRoles` (e.g. `['super_admin']` or `null` for public/student).
   - `CommandPalette.jsx` provides `Ctrl+K` searchable navigation.
   - **Safest Integration Point:** Add an `'ML Practicals'` item in `navConfig.js` and an `'ml_lab'` view in `App.jsx`, conditionally rendered based on `VITE_ENABLE_MODULE_2_ML`.

---

## 3. Safest Integration Architecture for Module 2

```
                       ┌───────────────────────────────────────────────┐
                       │          React 19 Frontend (Vite)             │
                       │  - Sidebar / CommandPalette (Nav Entry)       │
                       │  - ML Practical Explorer View                 │
                       │  - ML Experiment & Workspace View             │
                       │  - Faculty Studio View ('professor')          │
                       └───────────────────────┬───────────────────────┘
                                               │ HTTPS / REST
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                              Express.js Backend API                                  │
│                                                                                      │
│   Existing Module 1 Routes:                    New Module 2 Routes:                  │
│   - /api/contests                              - /api/ml/status                      │
│   - /api/problems                              - /api/ml/practicals                  │
│   - /api/submissions                           - /api/ml/attempts                    │
│   - /api/leaderboard                           - /api/ml/datasets                    │
│                                                       │                              │
│   Shared Cross-Cutting Middleware:                    ▼                              │
│   - authenticate (JWT)                          Feature Flag Guard                   │
│   - authorizeRoles ('student' / 'professor')   (ENABLE_MODULE_2_ML)                  │
│   - Rate Limiters & AuditLogger                       │                              │
└──────────────────────────┬────────────────────────────┼──────────────────────────────┘
                           │                            │
                           ▼                            ▼
         ┌──────────────────────────────────┐  ┌───────────────────────────────────┐
         │       PostgreSQL Database        │  │     Isolated ML Execution         │
         │                                  │  │     Worker / Sandbox Layer        │
         │  Module 1 Tables (Untouched):    │  │                                   │
         │  - users (ratings preserved)     │  │  - Isolated Container / Subprocess│
         │  - contests, problems, ratings   │  │  - Read-Only Training/Test Data   │
         │                                  │  │  - Strict CPU/RAM/Timeout Cgroups │
         │  Module 2 Tables (Isolated):     │  │  - Output Metrics & Rubric Score  │
         │  - ml_practicals                 │  │  - Zero Access to Express Process │
         │  - ml_datasets                   │  └─────────────────▲─────────────────┘
         │  - ml_attempts                   │                    │
         │  - ml_grades                     │────────────────────┘
         └──────────────────────────────────┘    Async Job Enqueue & Verdict Polling
```

---

## 4. Proposed Database Schema (Minimum Viable Foundation)

> **Note:** As specified in the instructions, these schema definitions are proposed and **not applied yet**.

### 4.1 Schema Principles
1. **Isolated Namespacing:** All Module 2 tables are prefixed with `ml_`.
2. **Referential Integrity:** User references use `REFERENCES users(id) ON DELETE RESTRICT` or `CASCADE` where appropriate.
3. **Rating Invariant:** No columns in `users` are added or mutated; `rating_history` is never referenced.
4. **Soft State & Auditing:** Attempt statuses and audit trails preserve execution reproducibility.

### 4.2 Proposed DDL

```sql
-- ========================================================
-- MODULE 2: MACHINE LEARNING VIRTUAL PRACTICAL LAB SCHEMA
-- ========================================================

-- 1. ML DATASETS TABLE
-- Stores metadata and access controls for practical datasets
CREATE TABLE IF NOT EXISTS ml_datasets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT DEFAULT '',
    storage_path VARCHAR(500) NOT NULL,
    file_format VARCHAR(30) NOT NULL CHECK (file_format IN ('csv', 'parquet', 'json', 'npz', 'zip')),
    access_type VARCHAR(30) NOT NULL DEFAULT 'public_train' CHECK (access_type IN ('public_train', 'hidden_eval', 'sample')),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum_sha256 VARCHAR(64) NOT NULL,
    schema_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_count INTEGER DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ml_datasets_access ON ml_datasets(access_type, is_active);
CREATE INDEX IF NOT EXISTS idx_ml_datasets_created_by ON ml_datasets(created_by);

-- 2. ML PRACTICALS TABLE
-- Defines ML lab assignments authored by faculty
CREATE TABLE IF NOT EXISTS ml_practicals (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(120) UNIQUE NOT NULL,
    title VARCHAR(250) NOT NULL,
    description TEXT NOT NULL,
    track VARCHAR(50) NOT NULL DEFAULT 'general' CHECK (track IN ('regression', 'classification', 'nlp', 'cv', 'deep_learning', 'general')),
    difficulty VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    max_score NUMERIC(6, 2) NOT NULL DEFAULT 100.00 CHECK (max_score > 0),
    time_limit_seconds INTEGER NOT NULL DEFAULT 120 CHECK (time_limit_seconds >= 10 AND time_limit_seconds <= 600),
    memory_limit_mb INTEGER NOT NULL DEFAULT 2048 CHECK (memory_limit_mb >= 512 AND memory_limit_mb <= 8192),
    starter_code TEXT NOT NULL DEFAULT '',
    evaluation_metric VARCHAR(50) NOT NULL DEFAULT 'accuracy' CHECK (evaluation_metric IN ('accuracy', 'f1_score', 'rmse', 'mae', 'auc_roc', 'custom')),
    evaluation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    rubric_config JSONB NOT NULL DEFAULT '{"metrics_weight": 0.7, "code_quality_weight": 0.3}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    access_scope VARCHAR(30) NOT NULL DEFAULT 'public' CHECK (access_scope IN ('public', 'class', 'institution')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ml_practicals_status ON ml_practicals(status);
CREATE INDEX IF NOT EXISTS idx_ml_practicals_track ON ml_practicals(track);
CREATE INDEX IF NOT EXISTS idx_ml_practicals_created_by ON ml_practicals(created_by);

-- 3. ML PRACTICAL DATASETS JUNCTION TABLE
-- Maps datasets to practicals with explicit role separation
CREATE TABLE IF NOT EXISTS ml_practical_datasets (
    practical_id INTEGER NOT NULL REFERENCES ml_practicals(id) ON DELETE CASCADE,
    dataset_id INTEGER NOT NULL REFERENCES ml_datasets(id) ON DELETE RESTRICT,
    dataset_role VARCHAR(30) NOT NULL CHECK (dataset_role IN ('train', 'hidden_test', 'sample_validation')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (practical_id, dataset_id, dataset_role)
);

CREATE INDEX IF NOT EXISTS idx_ml_practical_datasets_lookup ON ml_practical_datasets(practical_id, dataset_role);

-- 4. ML ATTEMPTS / SUBMISSIONS TABLE
-- Records both interactive experiment runs and formal evaluated attempts
CREATE TABLE IF NOT EXISTS ml_attempts (
    id SERIAL PRIMARY KEY,
    practical_id INTEGER NOT NULL REFERENCES ml_practicals(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_type VARCHAR(30) NOT NULL DEFAULT 'submission' CHECK (attempt_type IN ('run', 'submission')),
    source_type VARCHAR(30) NOT NULL DEFAULT 'script' CHECK (source_type IN ('script', 'notebook')),
    submitted_code TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timeout', 'oom', 'system_error')),
    execution_time_ms INTEGER DEFAULT 0,
    peak_memory_mb INTEGER DEFAULT 0,
    exit_code INTEGER DEFAULT NULL,
    stdout_output TEXT DEFAULT '',
    stderr_sanitized TEXT DEFAULT '',
    metric_results JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ml_attempts_user_practical ON ml_attempts(user_id, practical_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_attempts_status ON ml_attempts(status);

-- 5. ML GRADES & EVALUATION RESULTS TABLE
-- Strictly records practical lab academic outcomes; completely isolated from contest ratings
CREATE TABLE IF NOT EXISTS ml_grades (
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER UNIQUE NOT NULL REFERENCES ml_attempts(id) ON DELETE CASCADE,
    practical_id INTEGER NOT NULL REFERENCES ml_practicals(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    final_score NUMERIC(6, 2) NOT NULL CHECK (final_score >= 0.00),
    max_score NUMERIC(6, 2) NOT NULL CHECK (max_score > 0.00),
    rubric_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    empirical_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    feedback_notes TEXT DEFAULT '',
    grader_type VARCHAR(30) NOT NULL DEFAULT 'automated' CHECK (grader_type IN ('automated', 'faculty_override')),
    graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    graded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ml_grades_user_practical ON ml_grades(user_id, practical_id);
CREATE INDEX IF NOT EXISTS idx_ml_grades_practical ON ml_grades(practical_id);
```

### 4.3 Migration Strategy
1. **File Placement:** Migration logic will be prepared in `backend/src/database/migrations/ml_module_schema.sql`.
2. **Idempotent Hook:** Incorporate conditionally into `initDb.js`:
   ```javascript
   // Apply ML schema migration only if ENABLE_MODULE_2_ML is active or DB init flag is set
   if (config.module2MlEnabled || process.env.RUN_ML_MIGRATIONS === 'true') {
     const mlSchemaPath = path.resolve(__dirname, '../database/migrations/ml_module_schema.sql');
     if (fs.existsSync(mlSchemaPath)) {
       const mlSql = fs.readFileSync(mlSchemaPath, 'utf8');
       await query(mlSql);
     }
   }
   ```
3. **No Migration Execution in Task ML-1:** In accordance with the prompt, no schema changes are applied to the active database in this task.

---

## 5. API Contracts for Module 2

### 5.1 Status & Health Probe

#### `GET /api/ml/status`
Checks if Module 2 is active, returns capability metadata, or provides safe disabled indication.
- **Access:** Public
- **Headers:** Optional `Authorization: Bearer <token>`
- **Response (When Enabled - 200 OK):**
```json
{
  "status": "success",
  "data": {
    "module": "module_2_ml_lab",
    "version": "1.0.0-foundation",
    "enabled": true,
    "capabilities": {
      "pythonRuntimes": ["3.11"],
      "supportedLibraries": ["numpy", "pandas", "scikit-learn", "scipy", "torch"],
      "interactiveRunAllowed": true,
      "maxDatasetUploadBytes": 104857600
    },
    "maintenanceMode": false
  },
  "requestId": "9a38f3cf-4710-449e-bd8b-28562d9fb221",
  "timestamp": "2026-10-12T11:15:30.000Z"
}
```
- **Response (When Disabled - 503 Service Unavailable):**
```json
{
  "status": "error",
  "statusCode": 503,
  "error": "FEATURE_DISABLED",
  "message": "Module 2 (ML Virtual Practical Lab) is currently disabled on this deployment.",
  "requestId": "8f21e5dc-b118-4a6c-94cc-1912f20c22fa",
  "timestamp": "2026-10-12T11:15:30.000Z"
}
```

---

### 5.2 Practicals Discovery & Catalog

#### `GET /api/ml/practicals`
List all accessible ML practicals with filtering, search, and pagination.
- **Access:** Public (for public practicals) / Authenticated
- **Query Parameters:**
  - `page`: Integer (default: 1)
  - `limit`: Integer (default: 20, max: 50)
  - `track`: String (`all`, `regression`, `classification`, `nlp`, `cv`, `deep_learning`)
  - `difficulty`: String (`all`, `easy`, `medium`, `hard`)
  - `search`: String (searches title and description)
- **Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "practicals": [
      {
        "id": 1,
        "slug": "linear-regression-housing-prices",
        "title": "Predicting Housing Prices with Multiple Linear Regression",
        "description": "Build, regularize, and evaluate a linear regression model on tabular real estate data.",
        "track": "regression",
        "difficulty": "easy",
        "maxScore": 100.0,
        "evaluationMetric": "rmse",
        "timeLimitSeconds": 60,
        "memoryLimitMb": 2048,
        "accessScope": "public",
        "datasets": [
          {
            "id": 101,
            "name": "housing_train.csv",
            "accessType": "public_train",
            "sizeBytes": 450210,
            "fileFormat": "csv"
          }
        ],
        "createdAt": "2026-10-01T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  },
  "requestId": "3a032d1e-e244-4632-a5d6-d082f42a5bc1",
  "timestamp": "2026-10-12T11:15:30.000Z"
}
```

---

### 5.3 Practical Details

#### `GET /api/ml/practicals/:id`
Fetch complete instructions, starter code, sample data schema, and rubric breakdown.
- **Access:** Public or Authenticated (BOLA checked)
- **Security Rule:** Hidden evaluation datasets are **never** included in this response.
- **Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "practical": {
      "id": 1,
      "slug": "linear-regression-housing-prices",
      "title": "Predicting Housing Prices with Multiple Linear Regression",
      "description": "...",
      "track": "regression",
      "difficulty": "easy",
      "maxScore": 100.0,
      "timeLimitSeconds": 60,
      "memoryLimitMb": 2048,
      "starterCode": "import pandas as pd\nimport numpy as np\nfrom sklearn.linear_model import Ridge\n\ndef train_model(train_df):\n    # TODO: Implement model training\n    pass\n",
      "evaluationMetric": "rmse",
      "rubricConfig": {
        "metricsWeight": 0.7,
        "codeQualityWeight": 0.3,
        "targetRmseBaseline": 45000.0
      },
      "publicDatasets": [
        {
          "id": 101,
          "name": "housing_train.csv",
          "downloadUrl": "/api/ml/datasets/101/download",
          "fileFormat": "csv",
          "sizeBytes": 450210,
          "schemaMetadata": {
            "features": ["sqft", "bedrooms", "bathrooms", "zipcode"],
            "target": "price"
          }
        }
      ]
    }
  },
  "requestId": "5e143fa9-a0e2-41ba-ba37-d7b3e02026a0",
  "timestamp": "2026-10-12T11:15:30.000Z"
}
```

---

### 5.4 Code Execution & Attempt Submission

#### `POST /api/ml/practicals/:id/run` (Interactive Test Run)
- **Access:** Authenticated (`'student'`, `'professor'`, `'super_admin'`)
- **Rate Limit:** `ML_INTERACTIVE_RUN` (10 req/min)
- **Payload:**
```json
{
  "sourceType": "script",
  "submittedCode": "import pandas as pd\nprint('Testing execution environment')"
}
```
- **Response (202 Accepted):**
```json
{
  "status": "success",
  "data": {
    "attemptId": 801,
    "status": "queued",
    "message": "Execution job queued successfully."
  },
  "requestId": "6b37da41-f761-4fa2-bc51-c0ef228be001",
  "timestamp": "2026-10-12T11:15:30.000Z"
}
```

#### `POST /api/ml/practicals/:id/submit` (Official Submission for Grading)
- **Access:** Authenticated (`'student'`, `'professor'`, `'super_admin'`)
- **Rate Limit:** `ML_OFFICIAL_SUBMIT` (5 req/min)
- **Payload:**
```json
{
  "sourceType": "script",
  "submittedCode": "def train_model(train_df): ..."
}
```

#### `GET /api/ml/attempts/:attemptId` (Polling Execution Status & Grades)
- **Access:** Authenticated (Owner student, or `'professor'`, `'super_admin'`)
- **Response (200 OK - Terminal State):**
```json
{
  "status": "success",
  "data": {
    "attemptId": 801,
    "practicalId": 1,
    "status": "completed",
    "executionTimeMs": 3410,
    "peakMemoryMb": 284,
    "stdoutOutput": "Dataset loaded: 1460 rows.\nModel training complete.\n",
    "metricResults": {
      "rmse": 32150.45,
      "baselineExceeded": true
    },
    "grade": {
      "finalScore": 92.5,
      "maxScore": 100.0,
      "rubricBreakdown": {
        "empiricalMetricScore": 67.5,
        "maxMetricScore": 70.0,
        "executionEfficiencyScore": 25.0,
        "maxEfficiencyScore": 30.0
      },
      "feedbackNotes": "Exceeded accuracy baseline. Memory within expected bounds."
    }
  },
  "requestId": "e1f207ac-8722-48a0-9745-f09c73df85e2",
  "timestamp": "2026-10-12T11:15:30.000Z"
}
```

---

## 6. Access Control & Role-Based Permissions

### 6.1 Role Matrix for Module 2

| Resource / Action | Endpoint | Student | Professor | Contest Admin | Super Admin |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Check Module Status | `GET /api/ml/status` | Allowed | Allowed | Allowed | Allowed |
| Browse Published Practicals | `GET /api/ml/practicals` | Allowed | Allowed | Allowed | Allowed |
| View Draft Practicals | `GET /api/ml/practicals` | Denied | Own Drafts | All Drafts | All Drafts |
| Download Public Train Data | `GET /api/ml/datasets/:id/download` | Allowed | Allowed | Allowed | Allowed |
| Download Hidden Eval Data | `GET /api/ml/datasets/:id/download` | **DENIED (403)** | Own Practicals | Allowed | Allowed |
| Interactive Test Run | `POST /api/ml/practicals/:id/run` | Allowed | Allowed | Allowed | Allowed |
| Official Graded Submit | `POST /api/ml/practicals/:id/submit` | Allowed | Allowed | Allowed | Allowed |
| View Own Attempts & Grades | `GET /api/ml/attempts/:id` | Own Only | Own Only | All | All |
| View All Student Submissions | `GET /api/ml/practicals/:id/submissions`| **DENIED (403)** | Allowed | Allowed | Allowed |
| Author / Edit Practical | `POST/PUT /api/ml/practicals` | **DENIED (403)** | Allowed | Allowed | Allowed |
| Upload Evaluation Datasets | `POST /api/ml/datasets` | **DENIED (403)** | Allowed | Allowed | Allowed |
| Override Student Grade | `POST /api/ml/grades/:id/override` | **DENIED (403)** | Allowed | Allowed | Allowed |

### 6.2 Implementation with Existing Middleware
All access control uses the existing `backend/src/middleware/authMiddleware.js` and `backend/src/middleware/roleMiddleware.js`:

```javascript
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

// Public / Authenticated discovery
router.get('/practicals', optionalAuthenticate, mlPracticalController.listPracticals);
router.get('/practicals/:id', optionalAuthenticate, mlPracticalController.getPracticalDetails);

// Student & Faculty execution
router.post('/practicals/:id/run', authenticate, mlExecutionController.runCode);
router.post('/practicals/:id/submit', authenticate, mlExecutionController.submitCode);

// Faculty authoring & dataset management (using existing 'professor' role)
router.post('/practicals', authenticate, authorizeRoles('professor', 'contest_admin', 'super_admin'), mlPracticalController.createPractical);
router.post('/datasets', authenticate, authorizeRoles('professor', 'contest_admin', 'super_admin'), mlDatasetController.uploadDataset);
router.post('/grades/:id/override', authenticate, authorizeRoles('professor', 'super_admin'), mlGradeController.overrideGrade);
```

---

## 7. Navigation Integration Plan (Faculty & Students)

### 7.1 Architecture Grounding in `frontend/src/config/navConfig.js`
The navigation system is modular and role-aware. Nav groups filter items using `filterItemsByRole` based on `item.allowedRoles`.

### 7.2 Proposed Navigation Entries

```javascript
// Inside frontend/src/config/navConfig.js
export const NAV_GROUPS = [
  // Existing groups: 'main', 'compete'...
  {
    groupId: 'main',
    groupLabel: 'MAIN',
    items: [
      { id: 'landing', label: 'Home', iconName: 'Home', view: 'landing', allowedRoles: null },
      { id: 'problems', label: 'Problems', iconName: 'Code2', view: 'problems', allowedRoles: null },
      // New Module 2 Entry for Students & General Users
      {
        id: 'ml_practicals',
        label: 'ML Practical Lab',
        iconName: 'Cpu',
        view: 'ml_lab',
        allowedRoles: null,
        featureFlag: 'VITE_ENABLE_MODULE_2_ML'
      },
    ],
  },
  // Existing 'compete' group...
  {
    groupId: 'faculty',
    groupLabel: 'FACULTY STUDIO',
    items: [
      // New Module 2 Entry for Professors
      {
        id: 'ml_authoring',
        label: 'ML Lab Studio',
        iconName: 'Sparkles',
        view: 'ml_authoring',
        allowedRoles: ['professor', 'super_admin'],
        featureFlag: 'VITE_ENABLE_MODULE_2_ML'
      },
    ],
  },
  // Existing 'admin', 'account' groups...
];
```

### 7.3 Frontend View Handling (`frontend/src/App.jsx`)
1. **URL Route Matching:**
   - `/ml` or `/ml/practicals` -> `activeView = 'ml_lab'`.
   - `/ml/practicals/:id` -> `activeView = 'ml_workspace'`, loads target practical.
   - `/ml/studio` or `/ml/authoring` -> `activeView = 'ml_authoring'`.
2. **Command Palette Integration (`CommandPalette.jsx`):**
   - Register quick commands:
     - `"Browse ML Practicals"` -> `onSelectView('ml_lab')`
     - `"ML Lab Studio"` (visible only if `user.role === 'professor'`) -> `onSelectView('ml_authoring')`
3. **Graceful Disabled Fallback:**
   - If a user navigates directly to `/ml` when the feature flag is off, the app automatically navigates back to `/dashboard` or renders a graceful notification banner.

---

## 8. Feature Flag Definition & Isolation

### 8.1 Backend Feature Flag Configuration
In `backend/src/config/env.js`:
```javascript
const config = {
  // Existing configs...
  module2MlEnabled: process.env.ENABLE_MODULE_2_ML === 'true',
  mlWorkerConcurrency: parseInt(process.env.ML_WORKER_CONCURRENCY, 10) || 2,
};
```

### 8.2 Backend Guard Middleware (`backend/src/middleware/mlFeatureGuard.js`)
```javascript
const config = require('../config/env');

const requireModule2Enabled = (req, res, next) => {
  if (!config.module2MlEnabled) {
    return res.status(503).json({
      status: 'error',
      statusCode: 503,
      error: 'FEATURE_DISABLED',
      message: 'Module 2 (ML Virtual Practical Lab) is currently disabled.',
      requestId: req.id || null,
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

module.exports = { requireModule2Enabled };
```
In `backend/src/routes/index.js`:
```javascript
// Isolated mount: will not affect /api/problems, /api/contests, etc.
if (config.module2MlEnabled) {
  router.use('/ml', mlRoutes);
} else {
  router.use('/ml', requireModule2Enabled);
}
```

### 8.3 Frontend Feature Flag Configuration
In `frontend/src/config/featureFlags.js`:
```javascript
export const IS_MODULE_2_ENABLED = import.meta.env.VITE_ENABLE_MODULE_2_ML === 'true';
```
In `.env.example`:
```env
# Module 2 Feature Flags (Default: false)
ENABLE_MODULE_2_ML=false
VITE_ENABLE_MODULE_2_ML=false
```

---

## 9. Isolated Python Execution & Grading Worker Architecture

### 9.1 Why Untrusted Python Must Never Run in the Express Process
Student-submitted Python in an ML lab can execute arbitrary code:
- Calling `os.system()`, `subprocess.Popen()`, socket requests, or accessing environment variables.
- Consuming 100% CPU on multi-core matrices, starving Node.js event-loop workers.
- Triggering Out-Of-Memory (OOM) fatal kills that crash the entire Express web server.
- Writing to disk, overwriting local files, or inspecting other students' code.

### 9.2 Critical Review: Why JupyterHub / DockerSpawner Are Deferred
The prompt states:
> *"Do not add JupyterHub, DockerSpawner, a grading framework, or new infrastructure dependencies before reviewing the existing architecture and documenting why each is needed."*

#### Architectural Comparison Table

| Dimension | Option A: Full JupyterHub + DockerSpawner | Option B: Heavy Grading Framework (e.g. Otter-Grader / nbgrader) | Option C: Dedicated Async ML Worker Service (Recommended) |
| :--- | :--- | :--- | :--- |
| **Primary Purpose** | Stateful interactive web notebook kernels. | Batch grading of homework notebook assignments. | Headless evaluation of scripts/notebooks against structured metrics & rubrics. |
| **Memory Footprint** | Extremely heavy (~300MB - 1GB per active user container). | Moderate-High (requires complete Python environment per runner). | Controlled: fixed worker pool (e.g., 2 workers = fixed resource cap). |
| **Infrastructure Overhead** | Requires Proxy, Hub container, Docker daemon socket permissions, user state synchronization. | Requires custom grading harness, notebook cell metadata tagging, complex setup. | Minimal: Worker consumes jobs from PostgreSQL queue, executes in isolated container, updates DB. |
| **Integration with CODEFROG** | High friction (separate auth bridge, separate UI, iframe or port proxying). | Medium friction (requires specialized notebook format constraints). | Native: Reuses existing PostgreSQL connection pool, audit logs, and REST API conventions. |
| **Recommendation** | **DEFER.** Incur excessive operational burden prematurely. | **DEFER.** Hardcodes rigid cell format constraints before user needs are known. | **ADOPT for Phase 2.** Clean separation of concerns, fail-closed security, predictable resource ceilings. |

### 9.3 Proposed Worker Integration Flow (Post-Foundation)
1. **Queueing:** Express receives `/api/ml/practicals/:id/submit`, validates payload size and rate limits, saves `ml_attempts` with `status = 'queued'`, and returns 202 Accepted.
2. **Worker Dequeue:** An isolated worker service (written in Node.js or Python) polls or listens to queued attempts.
3. **Container Sandbox Invocation:**
   - Worker runs an ephemeral Docker container using a hardened ML runtime image (e.g., `codefrog-ml-sandbox:3.11`).
   - Container configuration:
     - `--network none` (complete network disconnection; no internet or intranet access).
     - `--read-only` root filesystem.
     - Ephemeral tmpfs mounted for `/workspace` (cleaned on exit).
     - Read-only volume mount for datasets (`/datasets/train:ro`, `/datasets/eval:ro`).
     - Hard resource cgroups: `--memory 2048m`, `--cpus 1.5`, `--pids-limit 100`.
4. **Metric Evaluation & Grading:**
   - A privileged evaluation harness inside the container loads the ground truth from `/datasets/eval`, executes the student function/script, calculates empirical metrics (e.g., RMSE, F1), and outputs a structured JSON summary.
   - The ground-truth data is mounted read-only and is completely invisible to student code inspection.
5. **Database Update:** Worker updates `ml_attempts` status to `'completed'` and inserts results into `ml_grades`.

---

## 10. Focused Test Plan

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MODULE 2 TEST PLAN                              │
├──────────────────────────┬─────────────────────────────────────────────┤
│ 1. Disabled Flag Tests   │ Verify 503 / disabled contract on all APIs  │
│ 2. RBAC & BOLA Tests     │ Strict role separation ('student'/'prof')   │
│ 3. Database Invariants   │ Zero impact on Module 1 contest ratings     │
│ 4. Module 1 Regression   │ 100% pass rate on existing test runners     │
└──────────────────────────┴─────────────────────────────────────────────┘
```

### 10.1 Test Category 1: Feature Flag & Disabled State Verification
- **Test 1.1:** When `ENABLE_MODULE_2_ML=false`, `GET /api/ml/status` returns `{ enabled: false }` or HTTP 503 `FEATURE_DISABLED`.
- **Test 1.2:** When `ENABLE_MODULE_2_ML=false`, all mutating requests (`POST /api/ml/practicals`, `POST /api/ml/practicals/:id/submit`) return HTTP 503 `FEATURE_DISABLED` with standardized error envelope.
- **Test 1.3:** When `VITE_ENABLE_MODULE_2_ML=false`, frontend navigation items for ML Practical Lab and ML Studio do not appear in the DOM.

### 10.2 Test Category 2: Access Control & Permissions (RBAC + BOLA)
- **Test 2.1:** Unauthenticated request to protected endpoint `POST /api/ml/practicals/:id/submit` returns 401 `AUTHENTICATION_ERROR`.
- **Test 2.2:** Student account attempting `POST /api/ml/practicals` returns 403 `AUTHORIZATION_ERROR` and logs a security audit event in `audit_logs`.
- **Test 2.3:** Student account attempting to download hidden evaluation dataset (`GET /api/ml/datasets/:hiddenId/download`) returns 403 `AUTHORIZATION_ERROR`.
- **Test 2.4:** Student A attempting to inspect Student B's attempt (`GET /api/ml/attempts/:attemptOfB`) returns 403/404 (BOLA defense).
- **Test 2.5:** Professor account is allowed to create practicals, upload datasets, and view all student attempts for their practicals.

### 10.3 Test Category 3: Database Compatibility & Rating Invariant
- **Test 3.1:** Verify that creating an ML attempt or recording an ML grade makes **zero** modifications to `users.current_rating`, `users.highest_rating`, or `users.rated_contest_count`.
- **Test 3.2:** Verify that `rating_history` has zero rows inserted by ML activities.
- **Test 3.3:** Verify that database migration scripts execute idempotently without dropping or modifying existing Module 1 tables (`users`, `contests`, `problems`, `submissions`, `test_cases`).

### 10.4 Test Category 4: Module 1 Regression Suite
- **Backend Regression:** Run `node scripts/testRunner.js --category=all` to ensure all existing test suites (auth, contests, judge sandboxing, anti-cheat, problem versioning, admin governance) pass with zero failures.
- **Frontend Regression:** Run `npm test` in `frontend/` to confirm all navigation, contest, and dashboard suites pass.

---

## 11. Risks, Assumptions, and Unresolved Decisions

### 11.1 Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Compute / Resource Exhaustion** | High | High | Enforce strict worker concurrency ceilings (`ML_WORKER_CONCURRENCY=2`), per-user submission rate limits, and short process timeouts. |
| **Dataset Storage Bloat** | Medium | Medium | Store datasets outside Git repository in dedicated storage volume (`backend/storage/datasets/` or S3/MinIO bucket). Store only checksums and file paths in PostgreSQL. |
| **Evaluation Dataset Leakage** | Critical | Low | Run student code in container with read-only mount accessible only to the evaluator process; never return raw evaluation dataset paths or contents to client. |
| **Python Environment Dependency Drift** | Medium | Medium | Standardize sandbox dependencies via version-pinned `Dockerfile.ml-runner` and requirement lockfile. |

### 11.2 Key Assumptions
1. **Submission Format:** Phase 1 of Module 2 will focus on structured Python scripts (`.py`) defining evaluation functions or standard prediction pipelines before introducing complex multi-cell notebook (`.ipynb`) workflows.
2. **Dataset Formats:** Datasets will initially be tabular (CSV, Parquet) with structured schemas before expanding to large unstructured computer vision or audio files.
3. **Database Architecture:** PostgreSQL remains the single source of truth for both Module 1 and Module 2 metadata.

### 11.3 Unresolved Decisions (For User Review)

1. **Student Editor Interface for ML:**
   - *Option A:* Utilize existing `@monaco-editor/react` (already integrated in CODEFROG) configured for Python script editing with an inline console and dataset schema preview tab.
   - *Option B:* Integrate a full interactive notebook cell editor.
   - *Recommendation:* Start with Option A (Monaco Python Editor + Dataset Schema Viewer). It provides an immediate, zero-dependency, highly polished experience matching the existing CODEFROG design system.
2. **Dataset Storage Provider:**
   - *Option A:* Local secure directory on host filesystem (`backend/storage/datasets/`) with SHA-256 integrity validation.
   - *Option B:* S3-compatible object storage (AWS S3 or MinIO).
   - *Recommendation:* Option A for development and local testing, designed with an abstraction interface (`StorageProvider`) allowing seamless plug-in of S3 later.
3. **Worker Orchestration Model:**
   - *Option A:* In-process async child-process worker with container sandboxing (similar to `JudgeQueue`).
   - *Option B:* Standalone background worker process decoupled via PostgreSQL transactional queue (`ml_attempts` status polling).
   - *Recommendation:* Option B provides complete process failure isolation from Express.

---

## 12. Implementation Sequence Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│  ML-1: Architecture Audit & Foundation Blueprint (Current Task)        │
│  - Deliverable: docs/module-2/ML-1-ARCHITECTURE-AUDIT.md               │
│  - Review & Approval Gate                                              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ML-2: Backend Foundation & Feature Flag Gating                        │
│  - Database migration script for ml_* tables                           │
│  - Feature flag configuration & requireModule2Enabled middleware       │
│  - Base models & status endpoint (/api/ml/status)                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ML-3: Practicals & Dataset Catalog APIs                               │
│  - Authoring & discovery REST endpoints                                │
│  - RBAC verification ('student' vs 'professor')                        │
│  - Unit & API integration test suites                                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ML-4: Isolated Execution Sandbox & Evaluation Worker                  │
│  - Hardened container runner with dataset mount & cgroup limits        │
│  - Metric calculation engine (RMSE, Accuracy, F1)                      │
│  - Attempt polling & grade recording                                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ML-5: Frontend Navigation & Student/Faculty UI                        │
│  - navConfig & AppShell integration                                    │
│  - ML Practical Explorer & Monaco Workspace                            │
│  - Faculty Studio for assignment & dataset configuration               │
└────────────────────────────────────────────────────────────────────────┘
```
