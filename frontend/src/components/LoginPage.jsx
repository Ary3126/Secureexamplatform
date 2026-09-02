import React, { useState, useEffect } from 'react';
import { LogIn, Eye, EyeOff, Lock, Mail, KeyRound, AlertCircle, ArrowRight, ShieldCheck, HelpCircle, X } from 'lucide-react';

const REMEMBER_EMAIL_KEY = 'securejudge_saved_email';

export default function LoginPage({
  onLogin,
  onNavigateSignup,
  onNavigateLanding,
}) {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_EMAIL_KEY) || 'student@university.edu';
    } catch (e) {
      return 'student@university.edu';
    }
  });
  const [password, setPassword] = useState('Password123!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(() => {
    try {
      return !!localStorage.getItem(REMEMBER_EMAIL_KEY);
    } catch (e) {
      return false;
    }
  });

  const [customToken, setCustomToken] = useState('');
  const [showDevToken, setShowDevToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [showForgotModal, setShowForgotModal] = useState(false);

  // Client-side validation
  const validateForm = () => {
    const errs = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email.trim()) {
      errs.email = 'Email address is required.';
    } else if (!emailRegex.test(email.trim())) {
      errs.email = 'Please enter a valid email address.';
    }

    if (!password) {
      errs.password = 'Password is required.';
    }

    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Direct token entry
    if (customToken.trim()) {
      const cleanToken = customToken.trim().replace(/^Bearer\s+/i, '');
      onLogin(cleanToken, { username: 'student_user', role: 'student' });
      return;
    }

    if (!validateForm()) return;

    setLoading(true);

    try {
      if (rememberEmail) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }

      let res;
      try {
        res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        });
      } catch (netErr) {
        // Fallback for direct backend port if vite proxy fails
        res = await fetch('http://localhost:5000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
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
        throw new Error(data.message || 'Invalid email or password. Please try again.');
      }

      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Unable to connect to server. Please check your network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card">
        {/* Header */}
        <div className="auth-header">
          <div className="auth-brand" onClick={onNavigateLanding} role="button" tabIndex={0} title="Back to Home">
            <ShieldCheck className="w-7 h-7 text-blue-500" />
            <span className="brand-name">SecureJudge</span>
          </div>
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">Sign in to your competitive programming account</p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="auth-error-banner" role="alert">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLoginSubmit} className="auth-form" noValidate>
          {/* Email Input */}
          <div className="form-group">
            <label htmlFor="login-email" className="form-label">
              Email Address
            </label>
            <div className="input-with-icon">
              <Mail className="input-icon" />
              <input
                id="login-email"
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
            <div className="form-label-row">
              <label htmlFor="login-password" className="form-label">
                Password
              </label>
              <button
                type="button"
                className="forgot-password-link"
                onClick={() => setShowForgotModal(true)}
              >
                Forgot Password?
              </button>
            </div>
            <div className="input-with-icon">
              <Lock className="input-icon" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className={`form-input ${validationErrors.password ? 'input-error' : ''}`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (validationErrors.password) setValidationErrors((prev) => ({ ...prev, password: null }));
                }}
                placeholder="••••••••••••"
                autoComplete="current-password"
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
            {validationErrors.password && <span className="field-error-text">{validationErrors.password}</span>}
          </div>

          {/* Remember Me */}
          <div className="form-checkbox-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(e) => setRememberEmail(e.target.checked)}
                className="custom-checkbox"
              />
              <span>Remember my email</span>
            </label>
          </div>

          {/* Submit Button */}
          <button type="submit" className="btn btn-primary auth-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <div className="btn-spinner"></div>
                <span>Signing In...</span>
              </>
            ) : (
              <>
                <span>Sign In to Platform</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {/* Developer Direct JWT Toggle */}
          <div className="dev-token-section">
            <button
              type="button"
              className="dev-token-toggle"
              onClick={() => setShowDevToken(!showDevToken)}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{showDevToken ? 'Hide Developer Token Input' : 'Developer: Paste Direct JWT Token'}</span>
            </button>

            {showDevToken && (
              <div className="dev-token-box">
                <input
                  type="text"
                  className="form-input mono-input"
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  placeholder="Bearer eyJhbGciOi..."
                />
              </div>
            )}
          </div>
        </form>

        {/* Footer Link to Signup */}
        <div className="auth-footer">
          <span>Don't have an account?</span>{' '}
          <button type="button" className="auth-switch-link" onClick={onNavigateSignup}>
            Create an Account
          </button>
        </div>
      </div>

      {/* Forgot Password Informational Modal */}
      {showForgotModal && (
        <div className="modal-backdrop" onClick={() => setShowForgotModal(false)}>
          <div className="confirm-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <HelpCircle className="w-5 h-5 text-blue-400" />
              <h3>Password Reset</h3>
              <button
                type="button"
                className="modal-close-icon"
                onClick={() => setShowForgotModal(false)}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p style={{ marginTop: '10px', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6' }}>
              Self-service password reset is currently managed by platform administrators. For institutional accounts or password resets, please contact your contest administrator or professor.
            </p>
            <div className="confirm-modal-actions" style={{ marginTop: '20px' }}>
              <button type="button" className="btn btn-primary" onClick={() => setShowForgotModal(false)}>
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
