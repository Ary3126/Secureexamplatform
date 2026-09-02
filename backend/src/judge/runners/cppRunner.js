const path = require('path');
const fs = require('fs');
const BaseRunner = require('./baseRunner');

let cachedGpp = null;

function resolveGpp() {
  if (cachedGpp) return cachedGpp;
  if (process.env.CPP_COMPILER_PATH && fs.existsSync(process.env.CPP_COMPILER_PATH)) {
    cachedGpp = process.env.CPP_COMPILER_PATH;
    return cachedGpp;
  }

  // 1. Direct local w64devkit path
  const localPaths = [
    'C:\\ary\\w64devkit\\bin\\g++.exe',
    'C:\\w64devkit\\bin\\g++.exe',
  ];
  for (const lp of localPaths) {
    if (fs.existsSync(lp)) {
      cachedGpp = lp;
      return cachedGpp;
    }
  }

  // 2. Check WinGet packages directory
  try {
    const wingetPkgDir = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Dev\\AppData\\Local', 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetPkgDir)) {
      const entries = fs.readdirSync(wingetPkgDir);
      for (const e of entries) {
        const sub = path.join(wingetPkgDir, e);
        if (fs.statSync(sub).isDirectory()) {
          const directBin = path.join(sub, 'bin', 'g++.exe');
          if (fs.existsSync(directBin)) {
            cachedGpp = directBin;
            return cachedGpp;
          }
          const clangBin = path.join(sub, 'bin', 'clang++.exe');
          if (fs.existsSync(clangBin)) {
            cachedGpp = clangBin;
            return cachedGpp;
          }
          const mingwBin = path.join(sub, 'mingw64', 'bin', 'g++.exe');
          if (fs.existsSync(mingwBin)) {
            cachedGpp = mingwBin;
            return cachedGpp;
          }
        }
      }
    }
  } catch (e) {}

  // 3. Common install paths
  const commonPaths = [
    'C:\\Program Files\\LLVM\\bin\\clang++.exe',
    'C:\\MinGW\\bin\\g++.exe',
    'C:\\msys64\\ucrt64\\bin\\g++.exe',
    'C:\\msys64\\mingw64\\bin\\g++.exe',
    'C:\\TDM-GCC-64\\bin\\g++.exe',
  ];

  for (const cp of commonPaths) {
    if (fs.existsSync(cp)) {
      cachedGpp = cp;
      return cachedGpp;
    }
  }

  cachedGpp = 'g++';
  return cachedGpp;
}

/**
 * CppRunner - Handles C++ compilation and execution
 */
class CppRunner extends BaseRunner {
  constructor() {
    super('cpp', 'solution.cpp');
    this.binaryName = process.platform === 'win32' ? 'solution.exe' : 'solution';
  }

  async compile({ workspaceDir, timeoutMs = 10000 }) {
    const sourcePath = path.join(workspaceDir, this.sourceFileName);
    const outputPath = path.join(workspaceDir, this.binaryName);
    const compilerCmd = resolveGpp();

    const result = await this.executeProcess({
      cmd: compilerCmd,
      args: ['-O2', '-std=c++17', '-Wall', sourcePath, '-o', outputPath],
      cwd: workspaceDir,
      timeoutMs,
    });

    if (result.timedOut) {
      return {
        isSuccess: false,
        errorMessage: 'Compilation Time Limit Exceeded (compiler took too long)',
      };
    }

    if (result.exitCode !== 0 || !fs.existsSync(outputPath)) {
      return {
        isSuccess: false,
        errorMessage: this.sanitizeErrorMessage(result.stderr || 'C++ compilation failed.'),
      };
    }

    return {
      isSuccess: true,
      errorMessage: null,
    };
  }

  async run({ workspaceDir, inputData = '', timeLimitMs = 2000, memoryLimitMb = 256 }) {
    const binaryPath = path.join(workspaceDir, this.binaryName);

    if (!fs.existsSync(binaryPath)) {
      return {
        status: 'system_error',
        stdout: '',
        stderr: 'Compiled binary missing in workspace.',
        executionTimeMs: 0,
        memoryUsedKb: 0,
      };
    }

    const result = await this.executeProcess({
      cmd: binaryPath,
      args: [],
      cwd: workspaceDir,
      input: inputData,
      timeoutMs: timeLimitMs,
      maxOutputBytes: 512 * 1024,
    });

    if (result.timedOut) {
      return {
        status: 'time_limit_exceeded',
        stdout: result.stdout,
        stderr: 'Time Limit Exceeded',
        executionTimeMs: timeLimitMs,
        memoryUsedKb: result.memoryUsedKb,
      };
    }

    if (result.outputExceeded) {
      return {
        status: 'system_error',
        stdout: result.stdout,
        stderr: 'Output Limit Exceeded (Excessive standard output)',
        executionTimeMs: result.executionTimeMs,
        memoryUsedKb: result.memoryUsedKb,
      };
    }

    if (result.exitCode !== 0) {
      return {
        status: 'runtime_error',
        stdout: result.stdout,
        stderr: this.sanitizeErrorMessage(result.stderr || `Runtime Error (exit code ${result.exitCode})`),
        executionTimeMs: result.executionTimeMs,
        memoryUsedKb: result.memoryUsedKb,
      };
    }

    return {
      status: 'completed',
      stdout: result.stdout,
      stderr: result.stderr,
      executionTimeMs: result.executionTimeMs,
      memoryUsedKb: result.memoryUsedKb,
    };
  }

  sanitizeErrorMessage(rawError) {
    if (!rawError) return '';
    return rawError
      .replace(/.*[\\\/]solution\.cpp/g, 'solution.cpp')
      .replace(/C:\\.*\\temp\\.*\\/gi, '')
      .replace(/\/tmp\/.*\/solution\.cpp/g, 'solution.cpp')
      .trim();
  }
}

module.exports = CppRunner;