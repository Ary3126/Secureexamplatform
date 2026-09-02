import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../theme/ThemeContext';

export default function ThemeSelector({ className = '' }) {
  const { theme, setTheme } = useTheme();

  const options = [
    { id: 'light', label: 'Light', icon: Sun, title: 'Light Theme' },
    { id: 'dark', label: 'Dark', icon: Moon, title: 'Dark Theme' },
    { id: 'system', label: 'System', icon: Monitor, title: 'Follow System Theme' },
  ];

  return (
    <div
      className={`theme-segmented-control ${className}`}
      role="radiogroup"
      aria-label="Theme selection"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const isSelected = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={opt.label}
            title={opt.title}
            className={`theme-toggle-btn ${isSelected ? 'active' : ''}`}
            onClick={() => setTheme(opt.id)}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="theme-btn-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
