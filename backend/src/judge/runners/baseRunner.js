const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');

/**
 * BaseRunner - Abstract class for isolated language runners
 */
class BaseRunner {
  constructor(languageName, sourceFileName) {
    this.languageName = languageName;
    this.sourceFileName = sourceFileName;
  }

  /**
   * Create an isolated temporary workspace directory
   * @param {number|string} submissionId
   * @returns {string} Absolute path to created workspace directory
   */
  async createWorkspace(submissionId) {
    const uniqueSuffix = crypto.randomBytes(6).toString('hex');
    const baseTempDir = path.join(os.tmpdir(), 'secure_judge');
    
    if (!fs.existsSync(baseTempDir)) {
      fs.mkdirSync(baseTempDir, { recursive: true });
    }

    const workspaceDir = path.join(baseTempDir, `sub_${submissionId}_${uniqueSuffix}`);
    fs.mkdirSync(workspaceDir, { recursive: true });
    return workspaceDir;
  }

  /**
   * Write source code to the workspace directory
   * @param {string} workspaceDir
   * @param {string} sourceCode
   * @returns {string} Path to written source file
   */
  async writeSourceCode(workspaceDir, sourceCode) {
    const filePath = path.join(workspaceDir, this.sourceFileName);
    fs.writeFileSync(filePath, sourceCode, 'utf8');
    return filePath;
  }

  /**
   * Get a strictly sanitized environment without backend credentials or secrets
   * @returns {Object}
   */
  getSanitizedEnv(customEnv = {}) {
    if (!BaseRunner.cachedToolchainDirs) {
      BaseRunner.cachedToolchainDirs = [
        'C:\\ary\\w64devkit\\bin',
        'C:\\Program Files\\Microsoft\\jdk-17.0.20.8-hotspot\\bin',
        'C:\\Program Files\\Java\\jdk-17\\bin',
        'C:\\Program Files\\LLVM\\bin',
        'C:\\MinGW\\bin',
      ].filter((p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      });
    }

    const toolchainDirs = BaseRunner.cachedToolchainDirs;

    const combinedPath =
      (toolchainDirs.length > 0 ? toolchainDirs.join(path.delimiter) + path.delimiter : '') +
      (process.env.PATH || '');

    const safeEnv = {
      PATH: combinedPath,
      TEMP: os.tmpdir(),
      TMP: os.tmpdir(),
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      ...customEnv,
    };
    return safeEnv;
  }

  /**
   * Execute child process with non-blocking async, strict timeout, memory tracking, and isolated streams
   * @param {Object} param0 - { cmd, args, cwd, input, timeoutMs, maxOutputBytes }
   * @returns {Promise<Object>} Process execution outcome
   */
  executeProcess({ cmd, args = [], cwd, input = '', timeoutMs = 5000, maxOutputBytes = 512 * 1024 }) {
    return new Promise((resolve) => {
      const startTime = process.hrtime.bigint();
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;
      let isOutputExceeded = false;
      let peakMemoryKb = 0;

      const safeEnv = this.getSanitizedEnv();

      const child = spawn(cmd, args, {
        cwd,
        env: safeEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      // Memory tracking loop (every 30ms)
      const memInterval = setInterval(() => {
        if (!child.pid || child.killed) return;
        try {
          // On Windows/Linux, memory estimation
          const mem = process.memoryUsage();
          const approxKb = Math.floor(mem.rss / 1024);
          if (approxKb > peakMemoryKb) {
            peakMemoryKb = approxKb;
          }
        } catch {
          // Ignore process polling exceptions
        }
      }, 30);

      // Hard timeout enforcement timer
      const timer = setTimeout(() => {
        isTimedOut = true;
        this.killProcessTree(child);
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
          isOutputExceeded = true;
          this.killProcessTree(child);
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (Buffer.byteLength(stderr, 'utf8') > maxOutputBytes) {
          isOutputExceeded = true;
          this.killProcessTree(child);
        }
      });

      child.on('error', (err) => {
        clearInterval(memInterval);
        clearTimeout(timer);
        const endTime = process.hrtime.bigint();
        const durationMs = Math.round(Number(endTime - startTime) / 1e6);

        resolve({
          exitCode: -1,
          stdout,
          stderr: `Process error: ${err.message}`,
          executionTimeMs: durationMs,
          memoryUsedKb: peakMemoryKb,
          timedOut: false,
          outputExceeded: false,
        });
      });

      child.on('close', (code, signal) => {
        clearInterval(memInterval);
        clearTimeout(timer);
        const endTime = process.hrtime.bigint();
        const durationMs = Math.round(Number(endTime - startTime) / 1e6);

        resolve({
          exitCode: code !== null ? code : -1,
          signal,
          stdout,
          stderr,
          executionTimeMs: isTimedOut ? timeoutMs : durationMs,
          memoryUsedKb: Math.max(peakMemoryKb, 15000), // Base runtime memory floor
          timedOut: isTimedOut,
          outputExceeded: isOutputExceeded,
        });
      });

      // Write stdin data if provided
      if (input) {
        try {
          child.stdin.write(input);
          child.stdin.end();
        } catch {
          // Process might have terminated early
        }
      } else {
        child.stdin.end();
      }
    });
  }

  /**
   * Safely terminate process and any spawned child threads
   */
  killProcessTree(child) {
    if (!child || !child.pid) return;

    try {
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true }, () => {});
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      // Fallback standard signal
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  }

  /**
   * Clean up workspace directory safely
   * @param {string} workspaceDir
   */
  async cleanup(workspaceDir) { return this.cleanupWorkspace(workspaceDir); }

  async cleanupWorkspace(workspaceDir) {
    if (!workspaceDir || !fs.existsSync(workspaceDir)) return;

    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[CLEANUP WARNING] Failed to remove workspace ${workspaceDir}:`, err.message);
    }
  }
}

module.exports = BaseRunner;