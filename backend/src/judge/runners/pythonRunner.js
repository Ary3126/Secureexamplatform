const path = require('path');
const BaseRunner = require('./baseRunner');

/**
 * PythonRunner - Handles Python execution and syntax validation
 */
class PythonRunner extends BaseRunner {
  constructor() {
    super('python', 'solution.py');
    // Identify python binary
    this.pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  }

  /**
   * Validate Python syntax via py_compile
   * @param {Object} param0 - { workspaceDir, timeoutMs }
   * @returns {Promise<{ isSuccess: boolean, errorMessage: string|null }>}
   */
  async compile({ workspaceDir, timeoutMs = 5000 }) {
    const filePath = path.join(workspaceDir, this.sourceFileName);

    const result = await this.executeProcess({
      cmd: this.pythonCmd,
      args: ['-m', 'py_compile', filePath],
      cwd: workspaceDir,
      timeoutMs,
    });

    if (result.exitCode !== 0 || result.timedOut) {
      const sanitizedError = this.sanitizeErrorMessage(result.stderr || 'Syntax / compilation error in Python code.');
      return {
        isSuccess: false,
        errorMessage: sanitizedError,
      };
    }

    return {
      isSuccess: true,
      errorMessage: null,
    };
  }

  /**
   * Run test case against Python script
   * @param {Object} param0 - { workspaceDir, inputData, timeLimitMs, memoryLimitMb }
   * @returns {Promise<Object>}
   */
  async run({ workspaceDir, inputData = '', timeLimitMs = 2000, memoryLimitMb = 256 }) {
    const filePath = path.join(workspaceDir, this.sourceFileName);

    const result = await this.executeProcess({
      cmd: this.pythonCmd,
      args: [filePath],
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

  /**
   * Remove host workspace paths from error traces
   * @param {string} rawError
   * @returns {string}
   */
  sanitizeErrorMessage(rawError) {
    if (!rawError) return '';
    return rawError
      .replace(/File ".*[\\\/]solution\.py"/g, 'File "solution.py"')
      .replace(/C:\\.*\\temp\\.*\\/gi, '')
      .replace(/\/tmp\/.*\/solution\.py/g, 'solution.py')
      .trim();
  }
}

module.exports = PythonRunner;