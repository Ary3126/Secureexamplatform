import React from 'react';
import { RotateCcw } from 'lucide-react';

/**
 * Polished Loading State for Professor Panel
 */
export default function AuthoringLoadingState({ message = 'Loading studio data...' }) {
  return (
    <div
      style={{
        padding: '64px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
      }}
    >
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: '3px solid rgba(56, 189, 248, 0.2)',
          borderTopColor: '#38bdf8',
          animation: 'spin 0.8s linear infinite',
          marginBottom: '16px',
        }}
      />
      <span style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>{message}</span>
    </div>
  );
}
