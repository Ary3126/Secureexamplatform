import React from 'react';
import Editor from '@monaco-editor/react';
import { Terminal, Code2, Sparkles } from 'lucide-react';

export default function EditorPane({
  language = 'cpp',
  code = '',
  onCodeChange = () => {},
  codingMode = 'function',
  editorTheme = 'vs-dark',
}) {
  const getMonacoLanguage = (lang) => {
    switch (lang) {
      case 'cpp':
        return 'cpp';
      case 'python':
        return 'python';
      case 'java':
        return 'java';
      default:
        return 'plaintext';
    }
  };

  const lineCount = (code || '').split('\n').length;

  return (
    <div className="editor-pane-container">
      {/* Sleek, Non-Duplicated Editor Status Strip */}
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <div className="function-mode-tag">
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span>{codingMode === 'function' ? 'Function Mode' : 'Full Program Mode'}</span>
          </div>

          <div className="editor-lang-indicator">
            <Code2 className="w-3.5 h-3.5 text-slate-400" />
            <span className="editor-lang-text">
              {language === 'cpp' ? 'C++ (GCC 13)' : language === 'python' ? 'Python 3.11' : 'Java (OpenJDK 21)'}
            </span>
          </div>
        </div>

        <div className="toolbar-right">
          <div className="editor-meta-pill" title="Line count">
            <span>{lineCount} lines</span>
          </div>
          <div className="editor-meta-pill editor-status-ready">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>Ready</span>
          </div>
        </div>
      </div>

      {/* Monaco Code Editor */}
      <div className="monaco-wrapper">
        <Editor
          height="100%"
          language={getMonacoLanguage(language)}
          value={code}
          theme={editorTheme}
          onChange={(val) => onCodeChange(val || '')}
          options={{
            fontSize: 14,
            fontFamily: "'Fira Code', monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            cursorBlinking: 'smooth',
            bracketPairColorization: { enabled: true },
          }}
        />
      </div>
    </div>
  );
}