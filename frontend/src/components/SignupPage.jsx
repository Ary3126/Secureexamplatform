import React, { useState } from 'react';
import { UserPlus, Eye, EyeOff, Lock, Mail, User, ShieldCheck, AlertCircle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

export default function SignupPage({
  onSignupSuccess,
  onNavigateLogin,
  onNavigateLanding,
}) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  // Password requirement tests
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  // Strength score: 0 to 3
  const getPasswordStrength = () => {
    if (!password) return { level: 'none', label: '', percent: 0, color: 'transparent' };
    let score = 0;
    if (hasMinLength) score += 1;
    if (hasLetter && hasNumber) score += 1;
    if (hasSpecial || password.length >= 12) score += 1;

    if (score === 1) return { level: 'weak', label: 'Weak', percent: 33, color: '#f43f5e' };
    if (score === 2) return { level: 'medium', label: 'Medium', percent: 66, color: '#f59e0b' };
    return { level: 'strong', label: 'Strong', percent: 100, color: '#10b981' };
  };

  const strength = getPasswordStrength();

  const validateForm = () => {
    const errs = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;

    if (!fullName.trim() || fullName.trim().length < 2 || fullName.trim().length > 100) {
      errs.fullName = 'Full name must be between 2 and 100 characters.';
    }

    if (!username.trim() || !usernameRegex.test(username.trim())) {
      errs.username = 'Username must be 3-30 characters (letters, numbers, underscores only).';
    }

    if (!email.trim() || !emailRegex.test(email.trim())) {
      errs.email = 'Please enter a valid email address.';
    }

    if (!hasMinLength || !hasLetter || !hasNumber) {
      errs.password = 'Password must be at least 8 characters and include both letters and numbers.';
    }

    if (password !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }

    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) return;

    setLoading(true);

    try {
      let res;
      try {
        res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            username: username.trim(),
            email: email.trim(),
            password,
          }),
        });
      } catch (netErr) {
        res = await fetch('http://localhost:5000/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            username: username.trim(),
            email: email.trim(),
            password,
          }),
        });
      }

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (jsonErr) {
        throw new Error(`Server returned unexpected format (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data.message || 'Registration failed. Please check your information.');
      }

      // Auto-login upon successful registration
      try {
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        const loginData = await loginRes.json();
        if (loginRes.ok && loginData.token) {
          onSignupSuccess(loginData.token, loginData.user);
          return;
        }
      } catch (autoLoginErr) {}

      // Fallback redirect to login
      onNavigateLogin();
    } catch (err) {
      setError(err.message || 'Unable to complete registration. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card signup-card">
        {/* Header */}
        <div className="auth-header">
          <div className="auth-brand" onClick={onNavigateLanding} role="button" tabIndex={0} title="Back to Home">
            <ShieldCheck className="w-7 h-7 text-blue-500" />
            <span className="brand-name">CodeForge</span>
          </div>
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Join the competitive programming and examination platform</p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="auth-error-banner" role="alert">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSignupSubmit} className="auth-form" noValidate>
          {/* Full Name Input */}
          <div className="form-group">
            <label htmlFor="signup-fullname" className="form-label">
              Full Name
            </label>
            <div className="input-with-icon">
              <User className="input-icon" />
              <input
                id="signup-fullname"
                type="text"
                className={`form-input ${validationErrors.fullName ? 'input-error' : ''}`}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (validationErrors.fullName) setValidationErrors((prev) => ({ ...prev, fullName: null }));
                }}
                placeholder="Ary Patel"
                autoComplete="name"
                disabled={loading}
                required
              />
            </div>
            {validationErrors.fullName && <span className="field-error-text">{validationErrors.fullName}</span>}
          </div>

          {/* Username Input */}
          <div className="form-group">
            <label htmlFor="signup-username" className="form-label">
              Username
            </label>
            <div className="input-with-icon">
              <User className="input-icon" />
              <input
                id="signup-username"
                type="text"
                className={`form-input ${validationErrors.username ? 'input-error' : ''}`}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (validationErrors.username) setValidationErrors((prev) => ({ ...prev, username: null }));
                }}
                placeholder="ary_coder"
                autoComplete="username"
                disabled={loading}
                required
              />
            </div>
            {validationErrors.username && <span className="field-error-text">{validationErrors.username}</span>}
          </div>

          {/* Email Input */}
          <div className="form-group">
            <label htmlFor="signup-email" className="form-label">
              Email Address
            </label>
            <div className="input-with-icon">
              <Mail className="input-icon" />
              <input
                id="signup-email"
                type="email"
                className={`form-input ${validationErrors.email ? 'input-error' : ''}`}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (validationErrors.email) setValidationErrors((prev) => ({ ...prev, email: null }));
                }}
                placeholder="you@university.edu"
                autoComplete="email"
                disabled={loading}
                required
              />
            </div>
            {validationErrors.email && <span className="field-error-text">{validationErrors.email}</span>}
          </div>

          {/* Password Input */}
          <div className="form-group">
            <label htmlFor="signup-password" className="form-label">
              Password
            </label>
            <div className="input-with-icon">
              <Lock className="input-icon" />
              <input
                id="signup-password"
                type={showPassword ? 'text' : 'password'}
                className={`form-input ${validationErrors.password ? 'input-error' : ''}`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (validationErrors.password) setValidationErrors((prev) => ({ ...prev, password: null }));
                }}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                disabled={loading}
                required
              />
              <button
                type="button"
                className="input-action-btn"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Password Strength Meter */}
            {password.length > 0 && (
              <div className="password-strength-container">
                <div className="strength-bar-track">
                  <div
                    className="strength-bar-fill"
                    style={{
                      width: `${strength.percent}%`,
                      backgroundColor: strength.color,
                    }}
                  />
                </div>
                <div className="strength-label-row">
                  <span>Strength: <strong style={{ color: strength.color }}>{strength.label}</strong></span>
                </div>
              </div>
            )}

            {/* Requirements Pills */}
            <div className="password-requirements-grid">
              <span className={`req-item ${hasMinLength ? 'req-met' : ''}`}>
                {hasMinLength ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3" />}
                8+ Characters
              </span>
              <span className={`req-item ${hasLetter ? 'req-met' : ''}`}>
                {hasLetter ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3" />}
                Letters
              </span>
              <span className={`req-item ${hasNumber ? 'req-met' : ''}`}>
                {hasNumber ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3" />}
                Numbers
              </span>
            </div>

            {validationErrors.password && <span className="field-error-text">{validationErrors.password}</span>}
          </div>

          {/* Confirm Password Input */}
          <div className="form-group">
            <label htmlFor="signup-confirm-password" className="form-label">
              Confirm Password
            </label>
            <div className="input-with-icon">
              <Lock className="input-icon" />
              <input
                id="signup-confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                className={`form-input ${validationErrors.confirmPassword ? 'input-error' : ''}`}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (validationErrors.confirmPassword) setValidationErrors((prev) => ({ ...prev, confirmPassword: null }));
                }}
                placeholder="Re-type your password"
                autoComplete="new-password"
                disabled={loading}
                required
              />
              <button
                type="button"
                className="input-action-btn"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                title={showConfirmPassword ? 'Hide password' : 'Show password'}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {validationErrors.confirmPassword && (
              <span className="field-error-text">{validationErrors.confirmPassword}</span>
            )}
          </div>

          {/* Submit Button */}
          <button type="submit" className="btn btn-primary auth-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <div className="btn-spinner"></div>
                <span>Creating Account...</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Create Student Account</span>
              </>
            )}
          </button>
        </form>

        {/* Footer Link to Login */}
        <div className="auth-footer">
          <span>Already have an account?</span>{' '}
          <button type="button" className="auth-switch-link" onClick={onNavigateLogin}>
            Sign In Instead
          </button>
        </div>
      </div>
    </div>
  );
}
