# Phase 2 Report — Website Authentication, Profile & Role System

## Project: Secure Competitive Programming & Examination Platform
**Phase:** Phase 2 (User Database, JWT Authentication, Profile Management & RBAC)  
**Date:** August 2026  
**Status:** Completed & Fully Verified (28/28 Automated Tests Passed)  

---

## 1. Overview & Scope

Phase 2 introduces the foundational identity, authentication, profile management, and Role-Based Access Control (RBAC) system.

### Scope Delivered:
1. **User Database Schema:** PostgreSQL `users` table with constraints and indexes.
2. **User Registration:** `POST /api/auth/register` with strict `student` role enforcement.
3. **User Login & JWT:** `POST /api/auth/login` issuing signed JWT tokens with 24-hour expiration.
4. **Authentication Middleware:** `authenticate` middleware protecting private routes and validating `is_active` status.
5. **Protected Profile Management:** `GET /api/users/me` and `PUT /api/users/me`.
6. **Role-Based Access Control (RBAC):** `authorizeRoles(...roles)` middleware and verification test endpoints for `student`, `professor`, `contest_admin`, and `super_admin`.

---

## 2. Step-by-Step Implementation Summary

| Step | Action | Description |
|---|---|---|
| **Step 1** | **Database Schema Definition** | Created [src/database/schema.sql](file:///c:/ary/SecureExamPlatform/backend/src/database/schema.sql) defining the `users` table with case-insensitive unique indexes on `email` and `username`, role constraints, and timestamp fields. |
| **Step 2** | **Migration Runner** | Created [src/config/initDb.js](file:///c:/ary/SecureExamPlatform/backend/src/config/initDb.js) to automate schema migrations on startup or via `npm run db:init`. |
| **Step 3** | **User Data Model** | Created [src/models/userModel.js](file:///c:/ary/SecureExamPlatform/backend/src/models/userModel.js) encapsulating all parameterized SQL queries (`createUser`, `findUserByEmail`, `findUserByUsername`, `findUserById`, `updateUserProfile`, `updateUserRole`). |
| **Step 4** | **Auth Service** | Created [src/services/authService.js](file:///c:/ary/SecureExamPlatform/backend/src/services/authService.js) managing bcrypt password hashing (12 rounds), password verification, JWT generation & verification, and user payload sanitization. |
| **Step 5** | **Input Validation Middleware** | Created [src/middleware/validationMiddleware.js](file:///c:/ary/SecureExamPlatform/backend/src/middleware/validationMiddleware.js) validating email formats, password strength (>= 8 chars with letters and numbers), alphanumeric usernames, and full names. |
| **Step 6** | **JWT Auth Middleware** | Created [src/middleware/authMiddleware.js](file:///c:/ary/SecureExamPlatform/backend/src/middleware/authMiddleware.js) reading `Bearer <token>`, validating JWT signatures, confirming user existence in database, and checking active account status. |
| **Step 7** | **RBAC Middleware** | Created [src/middleware/roleMiddleware.js](file:///c:/ary/SecureExamPlatform/backend/src/middleware/roleMiddleware.js) providing `authorizeRoles(...allowedRoles)` returning `403 Forbidden` on role mismatches. |
| **Step 8** | **Controllers & Routes** | Created [src/controllers/authController.js](file:///c:/ary/SecureExamPlatform/backend/src/controllers/authController.js), [src/controllers/userController.js](file:///c:/ary/SecureExamPlatform/backend/src/controllers/userController.js), [src/routes/authRoutes.js](file:///c:/ary/SecureExamPlatform/backend/src/routes/authRoutes.js), [src/routes/userRoutes.js](file:///c:/ary/SecureExamPlatform/backend/src/routes/userRoutes.js), and [src/routes/rbacTestRoutes.js](file:///c:/ary/SecureExamPlatform/backend/src/routes/rbacTestRoutes.js). |
| **Step 9** | **Central Router & Server Update** | Mounted all routers in [src/routes/index.js](file:///c:/ary/SecureExamPlatform/backend/src/routes/index.js) and configured server auto-initialization in [src/server.js](file:///c:/ary/SecureExamPlatform/backend/src/server.js). |
| **Step 10** | **Automated Test Suite** | Created [test_phase2.js](file:///c:/ary/SecureExamPlatform/backend/test_phase2.js) covering 28 automated assertions across registration, login, profile updates, and RBAC enforcement. |

---

## 3. Database Schema (`users` table)

```sql
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'professor', 'contest_admin', 'super_admin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
```

---

## 4. Role-Based Access Control (RBAC) Matrix

| Role | Intended Platform Purpose | Access to `/api/admin/test` | Access to `/api/professor/test` | Access to `/api/contest-admin/test` |
|---|---|:---:|:---:|:---:|
| **`student`** | Default public role. Participates in contests/exams, views own profile. | ❌ (403) | ❌ (403) | ❌ (403) |
| **`professor`** | Manages exams and reviews academic submissions. | ❌ (403) | ✅ (200) | ❌ (403) |
| **`contest_admin`** | Manages competitive coding contests and problem banks. | ❌ (403) | ❌ (403) | ✅ (200) |
| **`super_admin`** | Global platform administration. | ✅ (200) | ❌ (403) | ❌ (403) |

---

## 5. API Reference & Postman Testing Guide

### 1. Register a New User
* **Method:** `POST`
* **URL:** `http://localhost:5000/api/auth/register`
* **Headers:** `Content-Type: application/json`
* **Body (Raw JSON):**
  ```json
  {
    "username": "ary123",
    "email": "ary@example.com",
    "password": "StrongPassword123",
    "fullName": "Ary Patel"
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "message": "Registration successful",
    "user": {
      "id": 1,
      "username": "ary123",
      "email": "ary@example.com",
      "fullName": "Ary Patel",
      "role": "student"
    }
  }
  ```

---

### 2. User Login
* **Method:** `POST`
* **URL:** `http://localhost:5000/api/auth/login`
* **Headers:** `Content-Type: application/json`
* **Body (Raw JSON):**
  ```json
  {
    "email": "ary@example.com",
    "password": "StrongPassword123"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "message": "Login successful",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "username": "ary123",
      "email": "ary@example.com",
      "fullName": "Ary Patel",
      "role": "student"
    }
  }
  ```

---

### 3. Get User Profile
* **Method:** `GET`
* **URL:** `http://localhost:5000/api/users/me`
* **Headers:** `Authorization: Bearer <YOUR_JWT_TOKEN>`
* **Response (200 OK):**
  ```json
  {
    "id": 1,
    "username": "ary123",
    "email": "ary@example.com",
    "fullName": "Ary Patel",
    "role": "student",
    "isActive": true,
    "createdAt": "2026-08-14T12:05:00.000Z",
    "updatedAt": "2026-08-14T12:05:00.000Z"
  }
  ```

---

### 4. Update Profile
* **Method:** `PUT`
* **URL:** `http://localhost:5000/api/users/me`
* **Headers:**
  * `Content-Type: application/json`
  * `Authorization: Bearer <YOUR_JWT_TOKEN>`
* **Body (Raw JSON):**
  ```json
  {
    "fullName": "Ary Patel Updated",
    "username": "ary_updated"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "message": "Profile updated successfully",
    "user": {
      "id": 1,
      "username": "ary_updated",
      "email": "ary@example.com",
      "fullName": "Ary Patel Updated",
      "role": "student",
      "isActive": true,
      "createdAt": "2026-08-14T12:05:00.000Z",
      "updatedAt": "2026-08-14T12:07:00.000Z"
    }
  }
  ```

---

### 5. RBAC Protected Test Endpoints
| Endpoint | Method | Allowed Role | Headers |
|---|---|---|---|
| `/api/admin/test` | `GET` | `super_admin` | `Authorization: Bearer <TOKEN>` |
| `/api/professor/test` | `GET` | `professor` | `Authorization: Bearer <TOKEN>` |
| `/api/contest-admin/test` | `GET` | `contest_admin` | `Authorization: Bearer <TOKEN>` |

---

## 6. Automated Test Results

Ran `npm test` (`test_phase2.js`):
```text
=======================================================
 TEST SUMMARY: 28 PASSED, 0 FAILED
=======================================================
```
All validation rules, uniqueness constraints, password hashing, JWT validations, and RBAC authorizations verified successfully.
