# 🛡️ Secure Competitive Programming & Examination Platform

[![React](https://img.shields.io/badge/React-19.x-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-VSCode_Engine-1E1E1E?style=flat-square&logo=visualstudiocode&logoColor=007ACC)](https://microsoft.github.io/monaco-editor/)

A production-grade, secure, multi-tenant platform designed for hosting competitive programming contests, academic coding examinations, automated multi-language judge evaluation, and comprehensive coder skill analytics.

---

## 🌟 Key Platform Features

### 💻 Code Execution & Multi-Language Sandboxing
- **Secure Sandboxing:** Isolated execution engine preventing malicious code invocation, memory exhaustion, and unauthorized filesystem/network access.
- **Multiple Language Runners:** Instant compilation and execution for C++, Python, Java, JavaScript, and more.
- **Strict Resource Limits:** Configurable CPU time limits (TL) and memory limits (ML) per problem and submission.

### 🔒 Examination Security & Anti-Cheat Governance
- **Full Audit Logging:** Detailed forensic timeline tracking IP, device fingerprints, focus changes, and action timestamps.
- **Multi-Stage Validation:** Pre-flight sanity checks, test case execution, verdict calculation, and post-submission integrity verification.
- **Lifecycle Locks:** Contest & Problem locks that prevent modification or deletion during active examination sessions.

### 📊 Coder Analytics & Skill Constellation
- **Skill Overview Matrix:** Granular tracking across core computer science competencies (Algorithms, Data Structures, Math, Dynamic Programming, etc.).
- **Interactive Visualizations:** Code Core SVG Emblem, Difficulty Orbit, and Topic Constellations representing coder proficiency.
- **Dynamic Rating System:** Elo / Glicko-inspired rating adjustments calculated on contest performance.

### 🎨 Modern UI/UX Design System
- **Dual Theme Support:** Seamless Light, Dark, and System Theme switching powered by dynamic CSS tokens.
- **Monaco Code Editor:** Integrated VS Code-like coding experience with custom keybindings, syntax highlighting, and inline problem testcase runner.
- **Responsive Navigation:** Command Palette (`Ctrl/Cmd + K`), Notification Center, and Role-Based Navigation (Student, Professor, Admin).

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, Vite, `@monaco-editor/react`, Lucide React, Vanilla CSS Design System |
| **Backend** | Node.js (CommonJS), Express.js, PostgreSQL (`pg` connection pool), `bcrypt`, `jsonwebtoken`, `helmet`, `cors` |
| **Database** | PostgreSQL with parameterized queries, ACID transactions, and relational schema migrations |
| **Judge Engine** | Multi-process containerized execution sandbox with resource guards |
| **Tooling** | Oxlint, Nodemon, Custom Multi-Category Test Runners |

---

## 📂 Project Structure

```text
SecureExamPlatform/
│
├── backend/
│   ├── src/
│   │   ├── config/             # Database connection & Environment configs
│   │   ├── controllers/        # Auth, Contest, Problem, Submission, Admin controllers
│   │   ├── database/           # Relational schema definitions & seed scripts
│   │   ├── middleware/         # JWT Auth, RBAC, Rate Limiting & Error handlers
│   │   ├── models/             # Parameterized PostgreSQL data models
│   │   ├── routes/             # REST API endpoint route definitions
│   │   ├── services/           # Business logic: Judge, Ratings, Audit & Health
│   │   └── server.js           # Express application entrypoint
│   ├── scripts/                # Backend test runner utilities
│   └── test_*.js               # Comprehensive test suites for all phases
│
├── frontend/
│   ├── src/
│   │   ├── assets/             # Vector icons, SVG badges, and platform imagery
│   │   ├── components/         # Reusable UI components & modals
│   │   │   ├── admin/          # Admin Governance, Audit Logs & Health dashboards
│   │   │   ├── authoring/      # Problem Authoring Studio & Review lifecycle
│   │   │   └── navigation/     # AppShell, TopBar, Sidebar, CommandPalette
│   │   ├── theme/              # Light / Dark ThemeContext provider
│   │   ├── App.jsx             # Main router & application container
│   │   └── index.css           # Global tokens, layout utilities & animations
│   ├── scripts/                # Frontend test runner utilities
│   └── vite.config.js          # Vite configuration
│
├── reports/                    # Architectural reports & milestone documentation
└── README.md                   # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or later)
- [PostgreSQL](https://www.postgresql.org/) (v14.0 or later)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

---

### 1. Database Setup
Create a PostgreSQL database and configure your environment variables:

```bash
# In PostgreSQL CLI (psql):
CREATE DATABASE secure_exam_platform;
```

---

### 2. Backend Setup

1. Navigate to the backend directory:
   ```powershell
   cd backend
   ```

2. Install dependencies:
   ```powershell
   npm install
   ```

3. Create a `.env` file in `backend/` with the following variables:
   ```env
   PORT=5000
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=your_password
   DB_NAME=secure_exam_platform
   JWT_SECRET=your_jwt_secret_key
   JWT_EXPIRES_IN=7d
   ```

4. Initialize the database schema:
   ```powershell
   npm run db:init
   ```

5. Start the backend development server:
   ```powershell
   npm run dev
   ```
   *Backend will run at:* `http://localhost:5000`

---

### 3. Frontend Setup

1. Open a new terminal and navigate to the frontend directory:
   ```powershell
   cd frontend
   ```

2. Install dependencies:
   ```powershell
   npm install
   ```

3. Start the Vite development server:
   ```powershell
   npm run dev
   ```
   *Frontend will run at:* `http://localhost:5173`

---

## 🧪 Running Tests

The platform includes comprehensive test suites across unit, feature, security, judge, and UI layers:

### Backend Test Suites
```powershell
cd backend

# Run all test suites
npm test

# Run category-specific tests
npm run test:unit
npm run test:security
npm run test:judge
npm run test:skills
npm run test:submissions
```

### Frontend Test Suites
```powershell
cd frontend

# Run all UI and integration tests
npm test

# Run specific feature tests
npm run test:auth
npm run test:dashboard
npm run test:contest
npm run test:leaderboard
```

---

## 👥 Roles & Access Control

| Role | Permissions |
| :--- | :--- |
| **Student / Candidate** | Browse public problems, participate in contests, submit solutions, view personal skill metrics and submission histories. |
| **Professor / Author** | Create and author problems, define test cases, manage contest schedules, and monitor candidate performance. |
| **Administrator** | Full system governance, user management, audit log inspection, server health monitoring, and dispute resolution. |

---

## 📜 License

This project is licensed under the [ISC License](LICENSE).