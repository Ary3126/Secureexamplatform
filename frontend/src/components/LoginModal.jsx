import React, { useState } from 'react';
import { X, LogIn } from 'lucide-react';

export default function LoginModal({ isOpen, onClose, onLogin, apiUrl = '' }) {
  const [email, setEmail] = useState('student@university.edu');
  const [password, setPassword] = useState('Password123!');
  const [customToken, setCustomToken] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    
    setLoading(true);

    try {
      if (customToken.trim()) {
        const cleanToken = customToken.trim().replace(/^Bearer\s+/i, '');
        onLogin(cleanToken, { username: 'student_ary', role: 'student' });
        onClose();
        return;
      }

      // Try proxy route first, fallback to http://localhost:5000 if needed
      let endpoint = '/api/auth/login';
      if (apiUrl && apiUrl.startsWith('http')) {
        endpoint = `${apiUrl}/api/auth/login`;
      }

      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        });
      } catch (networkErr) {
        // Fallback to direct localhost port 5000 if proxy failed
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
        throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(data.message || `Login failed with status ${res.status}`);
      }

      onLogin(data.token, data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '1.1rem' }}>
            <LogIn className="w-5 h-5 text-blue-400" />
            <span>Account Authentication</span>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #dc2626', color: '#fca5a5', padding: '8px 12px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '12px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Email</label>
            <input
              type="email"
              className="select-input"
              style={{ width: '100%' }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@university.edu"
              required
            />
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Password</label>
            <input
              type="password"
              className="select-input"
              style={{ width: '100%' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password123!"
              required
            />
          </div>

          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.75rem', margin: '4px 0' }}>— OR PASTE JWT TOKEN —</div>

          <div>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Direct JWT Token</label>
            <input
              type="text"
              className="select-input"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
              value={customToken}
              onChange={(e) => setCustomToken(e.target.value)}
              placeholder="eyJhbGciOi..."
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}