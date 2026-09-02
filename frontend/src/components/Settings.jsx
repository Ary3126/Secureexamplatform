import React, { useState, useEffect } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  User,
  Building2,
  FileText,
  Image,
  Code2,
  Sliders,
  Shield,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Laptop,
  Check,
} from 'lucide-react';
import { useTheme } from '../theme/ThemeContext';

const PREF_STORAGE_KEY = 'securejudge_user_editor_prefs';

export default function Settings({
  token,
  currentUser,
  userProfile = null,
  onProfileUpdated = () => {},
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  // Profile fields state
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [institution, setInstitution] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Editor & Coding preferences state
  const [defaultLanguage, setDefaultLanguage] = useState('cpp');
  const [fontSize, setFontSize] = useState('14');
  const [tabSize, setTabSize] = useState('4');
  const [autoCloseBrackets, setAutoCloseBrackets] = useState(true);
  const [bracketColorization, setBracketColorization] = useState(true);

  // Status feedback
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Populate initial values from userProfile or currentUser
  useEffect(() => {
    const sourceUser = userProfile || currentUser || {};
    setFullName(sourceUser.fullName || sourceUser.full_name || '');
    setUsername(sourceUser.username || '');
    setBio(sourceUser.bio || '');
    setInstitution(sourceUser.institution || '');
    setAvatarUrl(sourceUser.avatarUrl || sourceUser.avatar_url || '');

    // Load editor preferences from localStorage
    try {
      const savedPrefs = localStorage.getItem(PREF_STORAGE_KEY);
      if (savedPrefs) {
        const parsed = JSON.parse(savedPrefs);
        if (parsed.defaultLanguage) setDefaultLanguage(parsed.defaultLanguage);
        if (parsed.fontSize) setFontSize(parsed.fontSize);
        if (parsed.tabSize) setTabSize(parsed.tabSize);
        if (typeof parsed.autoCloseBrackets === 'boolean') setAutoCloseBrackets(parsed.autoCloseBrackets);
        if (typeof parsed.bracketColorization === 'boolean') setBracketColorization(parsed.bracketColorization);
      }
    } catch (e) {
      console.warn('Could not load editor preferences', e);
    }
  }, [userProfile, currentUser]);

  const handleSaveAll = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      // 1. Save Profile fields to Backend if authenticated
      if (token) {
        const payload = {
          fullName: fullName.trim(),
          bio: bio.trim(),
          institution: institution.trim(),
          avatarUrl: avatarUrl.trim(),
        };

        const res = await fetch('/api/users/me', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to update profile settings.');
        }

        // Notify parent to refresh user profile data
        if (onProfileUpdated) {
          onProfileUpdated(data.user);
        }
      }

      // 2. Save Editor & Interface Preferences to localStorage
      const prefsToSave = {
        defaultLanguage,
        fontSize,
        tabSize,
        autoCloseBrackets,
        bracketColorization,
      };
      localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefsToSave));

      setSuccessMsg('Settings saved successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'An error occurred while saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const sourceUser = userProfile || currentUser || {};
    setFullName(sourceUser.fullName || sourceUser.full_name || '');
    setBio(sourceUser.bio || '');
    setInstitution(sourceUser.institution || '');
    setAvatarUrl(sourceUser.avatarUrl || sourceUser.avatar_url || '');
    setSuccessMsg('');
    setErrorMsg('');
  };

  const themeOptions = [
    {
      id: 'light',
      label: 'Light Mode',
      desc: 'Crisp daylight interface with clean contrast',
      icon: Sun,
      color: '#f59e0b',
    },
    {
      id: 'dark',
      label: 'Dark Mode',
      desc: 'Deep slate coding workspace with glowing neon accents',
      icon: Moon,
      color: '#3b82f6',
    },
    {
      id: 'system',
      label: 'System Sync',
      desc: 'Automatically synchronizes with your device theme',
      icon: Monitor,
      color: '#8b5cf6',
    },
  ];

  return (
    <div className="settings-pane-container">
      {/* Header */}
      <div className="settings-pane-header">
        <div>
          <h2 className="settings-pane-title">Preferences & Settings</h2>
          <p className="settings-pane-subtitle">
            Manage your interface appearance, personal coder identity, institution, and workspace defaults.
          </p>
        </div>
        <div className="settings-header-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleReset}
            disabled={saving}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveAll}
            disabled={saving}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="settings-alert success">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="settings-alert danger">
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSaveAll} className="settings-sections-wrapper">
        {/* SECTION 1: APPEARANCE & THEME */}
        <div className="settings-card-block">
          <div className="settings-card-header">
            <div className="settings-icon-bubble cyan">
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="settings-section-title">Interface Appearance</h3>
              <p className="settings-section-desc">
                Select your preferred color theme. Currently active: <strong className="text-cyan-400 uppercase">{resolvedTheme}</strong>
              </p>
            </div>
          </div>

          <div className="settings-theme-grid">
            {themeOptions.map((opt) => {
              const Icon = opt.icon;
              const isSelected = theme === opt.id;
              return (
                <div
                  key={opt.id}
                  className={`theme-card-choice ${isSelected ? 'active' : ''}`}
                  onClick={() => setTheme(opt.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setTheme(opt.id)}
                >
                  <div className="theme-choice-top">
                    <div className="theme-icon-wrap" style={{ color: opt.color }}>
                      <Icon className="w-5 h-5" />
                    </div>
                    {isSelected && (
                      <span className="theme-active-tag">
                        <Check className="w-3 h-3" /> ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="theme-choice-title">{opt.label}</div>
                  <div className="theme-choice-desc">{opt.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION 2: IDENTITY & PROFILE */}
        <div className="settings-card-block">
          <div className="settings-card-header">
            <div className="settings-icon-bubble blue">
              <User className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="settings-section-title">Coder Identity & Public Bio</h3>
              <p className="settings-section-desc">
                Customize your display name, college affiliation, and coder biography visible on leaderboards.
              </p>
            </div>
          </div>

          <div className="settings-fields-grid">
            <div className="settings-field-group">
              <label className="settings-field-label">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span>Full Display Name</span>
              </label>
              <input
                type="text"
                className="settings-text-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Alex Turing"
              />
              <span className="settings-field-hint">Your public display name shown on profile and podium cards.</span>
            </div>

            <div className="settings-field-group">
              <label className="settings-field-label">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>College / University / Organization</span>
              </label>
              <input
                type="text"
                className="settings-text-input"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="e.g. Stanford University, MIT, IIT Bombay"
              />
              <span className="settings-field-hint">Enables your ranking on the College League Leaderboard.</span>
            </div>

            <div className="settings-field-group full-width">
              <label className="settings-field-label">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Coder Bio</span>
              </label>
              <textarea
                className="settings-textarea-input"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Describe your competitive programming journey, algorithmic focus areas, or goals..."
                rows={3}
              />
              <span className="settings-field-hint">A brief bio displayed in your Coder Identity Card.</span>
            </div>

            <div className="settings-field-group full-width">
              <label className="settings-field-label">
                <Image className="w-3.5 h-3.5 text-slate-400" />
                <span>Avatar Image URL (Optional)</span>
              </label>
              <input
                type="url"
                className="settings-text-input"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
              />
              <span className="settings-field-hint">If empty, your dynamic vector Code Core Emblem is generated automatically.</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: WORKSPACE & CODING PREFERENCES */}
        <div className="settings-card-block">
          <div className="settings-card-header">
            <div className="settings-icon-bubble emerald">
              <Code2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="settings-section-title">Practice Workspace Preferences</h3>
              <p className="settings-section-desc">
                Configure your default programming language, editor font sizing, and editor ergonomics.
              </p>
            </div>
          </div>

          <div className="settings-fields-grid">
            <div className="settings-field-group">
              <label className="settings-field-label">
                <Code2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Default Practice Language</span>
              </label>
              <select
                className="settings-select-input"
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
              >
                <option value="cpp">C++ (GCC 13 / C++20)</option>
                <option value="python">Python (Python 3.11)</option>
                <option value="java">Java (OpenJDK 21)</option>
              </select>
            </div>

            <div className="settings-field-group">
              <label className="settings-field-label">
                <Sliders className="w-3.5 h-3.5 text-slate-400" />
                <span>Editor Font Size</span>
              </label>
              <select
                className="settings-select-input"
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
              >
                <option value="13">13px — Compact</option>
                <option value="14">14px — Standard Default</option>
                <option value="16">16px — Large & Readable</option>
              </select>
            </div>

            <div className="settings-field-group">
              <label className="settings-field-label">
                <Sliders className="w-3.5 h-3.5 text-slate-400" />
                <span>Tab Indentation Size</span>
              </label>
              <select
                className="settings-select-input"
                value={tabSize}
                onChange={(e) => setTabSize(e.target.value)}
              >
                <option value="2">2 Spaces</option>
                <option value="4">4 Spaces (Standard)</option>
              </select>
            </div>

            <div className="settings-field-group">
              <label className="settings-field-label">
                <Laptop className="w-3.5 h-3.5 text-slate-400" />
                <span>Bracket Pairing & Auto-Closing</span>
              </label>
              <div className="settings-toggle-row">
                <label className="toggle-switch-wrap">
                  <input
                    type="checkbox"
                    checked={autoCloseBrackets}
                    onChange={(e) => setAutoCloseBrackets(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
                <span className="toggle-label-text">Auto-close quotes and brackets in Monaco Editor</span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 4: ACCOUNT & SECURITY OVERVIEW */}
        <div className="settings-card-block">
          <div className="settings-card-header">
            <div className="settings-icon-bubble amber">
              <Shield className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="settings-section-title">Account & Security Status</h3>
              <p className="settings-section-desc">
                Security overview and read-only authentication credentials.
              </p>
            </div>
          </div>

          <div className="account-info-grid">
            <div className="account-info-tile">
              <span className="acc-tile-label">Username Handle</span>
              <span className="acc-tile-val font-mono">@{username || 'guest'}</span>
            </div>

            <div className="account-info-tile">
              <span className="acc-tile-label">Registered Email</span>
              <span className="acc-tile-val">{currentUser?.email || 'Protected'}</span>
            </div>

            <div className="account-info-tile">
              <span className="acc-tile-label">Account Role</span>
              <span className="acc-tile-val uppercase text-cyan-400">{currentUser?.role || 'STUDENT'}</span>
            </div>

            <div className="account-info-tile">
              <span className="acc-tile-label">Rating Status</span>
              <span className="acc-tile-val uppercase text-emerald-400">
                {currentUser?.ratingStatus || 'PROVISIONAL'}
              </span>
            </div>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="settings-bottom-actions-bar">
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleReset}
            disabled={saving}
          >
            Reset Form
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving Settings...' : 'Save All Preferences'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
