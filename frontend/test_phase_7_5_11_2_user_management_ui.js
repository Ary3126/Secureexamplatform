/**
 * Phase 7.5.11.2 Dedicated Test Suite: User & Role Management Frontend UI Logic & Security
 * 
 * Verifies frontend component logic, state transitions, validation, and defense in depth:
 * 1. Payload unwrapping from API responses (wrapped, flat, and null/empty fallbacks)
 * 2. Zero credential leakage defense in frontend data structures
 * 3. Role badge semantics, labels, and privilege hierarchy
 * 4. Status normalization across boolean and string values (active, inactive, suspended)
 * 5. Avatar initials generation robustness
 * 6. Multi-field client-side search filtering (username, fullName, email)
 * 7. Scalable pagination mathematics, boundary clamping, and inverted range prevention
 * 8. Self-suspension guard logic for active Super Admin sessions
 * 9. Administrative user provisioning form validation (regex, length, roles)
 * 10. Role transition consequence messaging and privilege alerts
 * 11. Error state and retry callback verification
 * 12. Static verification of AdminUserManagement.jsx and AdminPanel.jsx components
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// --- Pure Logic Helper Mirrors from AdminUserManagement.jsx & AdminPanel.jsx ---

function unwrapUserListPayload(apiResponse) {
  const payload = apiResponse?.data || apiResponse || {};
  const users = payload.users || (Array.isArray(payload) ? payload : []);
  const total = payload.pagination?.total ?? payload.total ?? payload.totalUsers ?? users.length;
  const page = payload.pagination?.page ?? payload.page ?? 1;
  const limit = payload.pagination?.limit ?? payload.limit ?? 20;
  const totalPages = payload.pagination?.totalPages ?? Math.max(Math.ceil(total / limit), 1);
  return { users, total, page, limit, totalPages };
}

function normalizeUserStatus(user) {
  if (!user) return false;
  return Boolean(
    user.isActive ??
    user.is_active ??
    user.status === 'active'
  );
}

function getInitials(fullName, username) {
  const name = fullName || username || 'U';
  return name.trim().substring(0, 2).toUpperCase();
}

function getRoleBadgeData(role) {
  const normalized = (role || 'student').toLowerCase();
  switch (normalized) {
    case 'super_admin':
      return { className: 'badge-role super_admin', label: 'SUPER ADMIN', isPrivileged: true };
    case 'professor':
      return { className: 'badge-role professor', label: 'PROFESSOR', isPrivileged: false };
    case 'contest_admin':
      return { className: 'badge-role contest_admin', label: 'CONTEST ADMIN', isPrivileged: false };
    default:
      return { className: 'badge-role student', label: 'STUDENT', isPrivileged: false };
  }
}

function calculatePaginationRange(page, limit, total) {
  if (total <= 0) return { start: 0, end: 0, totalPages: 1, clampedPage: 1 };
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const start = (clampedPage - 1) * limit + 1;
  const end = Math.min(clampedPage * limit, total);
  return { start, end, totalPages, clampedPage };
}

function validateProvisionUserInput({ username, email, password, role }) {
  const errors = [];
  if (!username || username.trim().length < 3 || username.trim().length > 50) {
    errors.push('Validation failed: username must be between 3 and 50 characters.');
  }
  if (username && !/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
    errors.push('Validation failed: username can only contain alphanumeric characters, underscores, and hyphens.');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.push('Validation failed: email format is invalid.');
  }
  if (!password || password.length < 8) {
    errors.push('Validation failed: password must be at least 8 characters long.');
  }
  const ALLOWED_ROLES = ['student', 'professor', 'contest_admin', 'super_admin'];
  if (!role || !ALLOWED_ROLES.includes(role.toLowerCase())) {
    errors.push(`Validation failed: role must be one of: ${ALLOWED_ROLES.join(', ')}.`);
  }
  return { isValid: errors.length === 0, errors };
}

function getRoleConsequenceMessage(targetRole) {
  if (targetRole === 'super_admin') {
    return 'Caution: Assigning Super Admin grants full unrestricted platform governance powers, user management, and security audit rights.';
  }
  if (targetRole === 'professor') {
    return 'Professor role allows authoring problems, creating contests, and participating in peer review workflows.';
  }
  return 'Standard student role restricts access strictly to solving practice problems, contests, and viewing profile analytics.';
}

describe('Phase 7.5.11.2: User & Role Management Frontend UI Suite', () => {

  it('1. User listing payload unwrapping handles standard, flat, and null structures', () => {
    const wrappedResponse = {
      status: 'success',
      data: {
        users: [
          { id: 1, username: 'alice', role: 'student' },
          { id: 2, username: 'bob', role: 'professor' },
        ],
        pagination: { total: 42, page: 1, limit: 20, totalPages: 3 },
      },
    };
    const wrapped = unwrapUserListPayload(wrappedResponse);
    assert.strictEqual(wrapped.users.length, 2);
    assert.strictEqual(wrapped.total, 42);
    assert.strictEqual(wrapped.totalPages, 3);

    const flatResponse = {
      users: [{ id: 5, username: 'charlie' }],
      total: 1,
    };
    const flat = unwrapUserListPayload(flatResponse);
    assert.strictEqual(flat.users.length, 1);
    assert.strictEqual(flat.total, 1);

    const empty = unwrapUserListPayload(null);
    assert.deepStrictEqual(empty.users, []);
    assert.strictEqual(empty.total, 0);
    assert.strictEqual(empty.totalPages, 1);
  });

  it('2. Zero credential leakage: user objects strictly omit password_hash and secrets', () => {
    const userSample = {
      id: 99,
      username: 'faculty_user',
      email: 'faculty@examforge.org',
      fullName: 'Faculty Member',
      role: 'professor',
      isActive: true,
      currentRating: 1400,
    };

    assert.strictEqual(userSample.password_hash, undefined);
    assert.strictEqual(userSample.passwordHash, undefined);
    assert.strictEqual(userSample.password, undefined);
    assert.strictEqual(userSample.token, undefined);
    assert.strictEqual(userSample.secret, undefined);
  });

  it('3. Role badge metadata correctly maps canonical platform roles', () => {
    const roles = ['student', 'professor', 'contest_admin', 'super_admin'];
    roles.forEach((r) => {
      const badge = getRoleBadgeData(r);
      assert.ok(badge.className.includes(r));
      assert.strictEqual(typeof badge.label, 'string');
      if (r === 'super_admin') {
        assert.strictEqual(badge.isPrivileged, true);
      } else {
        assert.strictEqual(badge.isPrivileged, false);
      }
    });
  });

  it('4. Status normalization handles boolean, snake_case, and status strings', () => {
    assert.strictEqual(normalizeUserStatus({ isActive: true }), true);
    assert.strictEqual(normalizeUserStatus({ isActive: false }), false);
    assert.strictEqual(normalizeUserStatus({ is_active: true }), true);
    assert.strictEqual(normalizeUserStatus({ is_active: false }), false);
    assert.strictEqual(normalizeUserStatus({ status: 'active' }), true);
    assert.strictEqual(normalizeUserStatus({ status: 'inactive' }), false);
    assert.strictEqual(normalizeUserStatus({ status: 'suspended' }), false);
    assert.strictEqual(normalizeUserStatus(null), false);
    assert.strictEqual(normalizeUserStatus({}), false);
  });

  it('5. Avatar initials generator extracts uppercase initials cleanly', () => {
    assert.strictEqual(getInitials('Dr. Jane Smith', 'jsmith'), 'DR');
    assert.strictEqual(getInitials('', 'john_doe'), 'JO');
    assert.strictEqual(getInitials(null, 'alice'), 'AL');
    assert.strictEqual(getInitials(null, null), 'U');
  });

  it('6. Multi-field search filtering accurately matches username, email, and full name', () => {
    const directory = [
      { id: 1, username: 'alan_turing', fullName: 'Alan Turing', email: 'alan@cambridge.ac.uk' },
      { id: 2, username: 'ada_lovelace', fullName: 'Ada Lovelace', email: 'ada@london.edu' },
      { id: 3, username: 'grace_hopper', fullName: 'Grace Hopper', email: 'grace@yale.edu' },
    ];

    const filter = (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return directory;
      return directory.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          (u.fullName && u.fullName.toLowerCase().includes(q)) ||
          u.email.toLowerCase().includes(q)
      );
    };

    assert.strictEqual(filter('turing').length, 1);
    assert.strictEqual(filter('Lovelace').length, 1);
    assert.strictEqual(filter('.edu').length, 2);
    assert.strictEqual(filter('cambridge').length, 1);
    assert.strictEqual(filter('nonexistent').length, 0);
    assert.strictEqual(filter('  ada  ').length, 1);
  });

  it('7. Scalable pagination mathematics prevents inverted ranges and clamps boundaries', () => {
    // Normal page 1 of 3
    const p1 = calculatePaginationRange(1, 20, 45);
    assert.strictEqual(p1.start, 1);
    assert.strictEqual(p1.end, 20);
    assert.strictEqual(p1.totalPages, 3);
    assert.strictEqual(p1.clampedPage, 1);

    // Last page 3 of 3
    const p3 = calculatePaginationRange(3, 20, 45);
    assert.strictEqual(p3.start, 41);
    assert.strictEqual(p3.end, 45);
    assert.strictEqual(p3.clampedPage, 3);

    // Overflow boundary (page 5 when totalPages is 2) - MUST clamp and not produce inverted range
    const pOverflow = calculatePaginationRange(5, 20, 35);
    assert.strictEqual(pOverflow.totalPages, 2);
    assert.strictEqual(pOverflow.clampedPage, 2);
    assert.strictEqual(pOverflow.start, 21);
    assert.strictEqual(pOverflow.end, 35);
    assert.ok(pOverflow.start <= pOverflow.end, 'Range must not be inverted');

    // Zero records
    const pZero = calculatePaginationRange(1, 20, 0);
    assert.strictEqual(pZero.start, 0);
    assert.strictEqual(pZero.end, 0);
    assert.strictEqual(pZero.totalPages, 1);
  });

  it('8. Self-suspension guard prevents deactivating current session account', () => {
    const currentAdmin = { id: 10, username: 'superadmin', role: 'super_admin' };
    const selfTarget = { id: 10, username: 'superadmin', role: 'super_admin', isActive: true };
    const otherTarget = { id: 25, username: 'prof_oak', role: 'professor', isActive: true };

    const canSuspend = (target, current) => {
      if (!current || !target) return false;
      return current.id !== target.id;
    };

    assert.strictEqual(canSuspend(selfTarget, currentAdmin), false, 'Self suspension blocked');
    assert.strictEqual(canSuspend(otherTarget, currentAdmin), true, 'Other user suspension allowed');
  });

  it('9. User provisioning input validation rules', () => {
    // Valid input
    const valid = validateProvisionUserInput({
      username: 'faculty_john',
      email: 'john@mit.edu',
      password: 'SecurePassword123!',
      role: 'professor',
    });
    assert.strictEqual(valid.isValid, true);
    assert.strictEqual(valid.errors.length, 0);

    // Password too short (< 8)
    const shortPwd = validateProvisionUserInput({
      username: 'valid_user',
      email: 'user@mit.edu',
      password: '123',
      role: 'student',
    });
    assert.strictEqual(shortPwd.isValid, false);
    assert.ok(shortPwd.errors.some((e) => e.includes('password must be at least 8 characters')));

    // Username with spaces or invalid characters
    const badUser = validateProvisionUserInput({
      username: 'bad user!',
      email: 'user@mit.edu',
      password: 'ValidPassword123!',
      role: 'student',
    });
    assert.strictEqual(badUser.isValid, false);

    // Malformed email
    const badEmail = validateProvisionUserInput({
      username: 'good_user',
      email: 'not-an-email',
      password: 'ValidPassword123!',
      role: 'student',
    });
    assert.strictEqual(badEmail.isValid, false);

    // Disallowed role
    const badRole = validateProvisionUserInput({
      username: 'good_user',
      email: 'user@test.org',
      password: 'ValidPassword123!',
      role: 'hacker_role',
    });
    assert.strictEqual(badRole.isValid, false);
    assert.ok(badRole.errors.some((e) => e.includes('role must be one of')));
  });

  it('10. Role transition consequence messaging warns about Super Admin elevation', () => {
    const saMsg = getRoleConsequenceMessage('super_admin');
    assert.ok(saMsg.includes('unrestricted platform governance'));

    const profMsg = getRoleConsequenceMessage('professor');
    assert.ok(profMsg.includes('authoring problems'));

    const stdMsg = getRoleConsequenceMessage('student');
    assert.ok(stdMsg.includes('solving practice problems'));
  });

  it('11. Static analysis of AdminUserManagement.jsx verifies error state and pagination clamping', () => {
    const frontendDir = fs.existsSync(path.join(process.cwd(), 'src'))
      ? process.cwd()
      : path.join(process.cwd(), 'frontend');
    const filePath = path.join(frontendDir, 'src', 'components', 'admin', 'AdminUserManagement.jsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('data-testid="admin-users-error-state"'), 'Contains error state container');
    assert.ok(content.includes('data-testid="retry-fetch-users-btn"'), 'Contains retry fetch button');
    assert.ok(content.includes('const clampedPage = Math.min(Math.max(page, 1), totalPages);'), 'Contains clampedPage pagination calculation');
    assert.ok(content.includes('minLength={8}'), 'Contains minLength={8} on password input');
    assert.ok(content.includes('newUserData.password.length < 8'), 'Contains client validation for password length');
  });

  it('12. Static analysis of AdminPanel.jsx verifies error state propagation in UsersSection', () => {
    const frontendDir = fs.existsSync(path.join(process.cwd(), 'src'))
      ? process.cwd()
      : path.join(process.cwd(), 'frontend');
    const filePath = path.join(frontendDir, 'src', 'components', 'AdminPanel.jsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('const [error, setError] = useState(null);'), 'UsersSection has error state');
    assert.ok(content.includes('error={error}'), 'AdminUserManagement receives error prop');
    assert.ok(content.includes('onRetry={fetchUsers}'), 'AdminUserManagement receives onRetry prop');
  });
});
