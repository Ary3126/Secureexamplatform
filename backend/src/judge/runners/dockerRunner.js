const path = require('path');
const BaseRunner = require('./baseRunner');
const SecurityLogger = require('../security/securityLogger');

// Module-level Docker circuit breaker
let isDockerHealthy = null; // null = untested, true = healthy, false = unreachable
let lastHealthCheckTime = 0;
const DOCKER_CHECK_TTL_MS = 30000; // Retry health check after 30 seconds

function markDockerUnreachable(reason = 'Daemon unreachable') {
  if (isDockerHealthy !== false) {
    SecurityLogger.warnViolation('DOCKER_UNAVAILABLE_FALLBACK', {
      reason: `Docker daemon unreachable (${reason}), falling back to native sandboxed runner`,
    });
  }
  isDockerHealthy = false;
  lastHealthCheckTime = Date.now();
}

function markDockerHealthy() {
  isDockerHealthy = true;
  lastHealthCheckTime = Date.now();
}

function shouldAttemptDocker() {
  if (isDockerHealthy === false) {
    if (Date.now() - lastHealthCheckTime < DOCKER_CHECK_TTL_MS) {
      return false;
    }
  }
  return true;
}

/**
 * DockerRunner - Compiles and executes code inside a hardened Docker container
 * with complete network isolation, capability dropping, resource limits, and non-root execution.
 * Falls back gracefully to native sandboxed process runner if Docker daemon is unreachable.
 */
class DockerRunner extends BaseRunner {
  constructor(language, baseRunner) {
    super(language, baseRunner.sourceFileName);
    this.innerRunner = baseRunner;
    this.imageName = process.env.DOCKER_JUDGE_IMAGE || 'secure-judge:latest';
  }

  getMountPath(workspaceDir) {
    const absPath = path.resolve(workspaceDir);
    return absPath.replace(/\\/g, '/');
  }

  isDockerDaemonError(errStr) {
    if (!errStr) return false;
    const str = String(errStr).toLowerCase();
    return str.includes('failed to connect to the docker api') ||
           str.includes('daemon is not running') ||
           str.includes('dockerdesktoplinuxengine') ||
           str.includes('cannot connect to the docker daemon') ||
           str.includes('command not found') ||
           str.includes('is not recognized as an internal or external command') ||
           str.includes('error during connect') ||
           str.includes('the system cannot find the file specified');
  }

  /**
   * Compile code inside hardened Docker container
   */
  async compile({ workspaceDir, timeoutMs = 10000 }) {
    if (!shouldAttemptDocker()) {
      return this.innerRunner.compile({ workspaceDir, timeoutMs });
    }

    const mountPath = this.getMountPath(workspaceDir);

    let compileArgs = [
      'run',
      '--rm',
      '--network', 'none',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--memory', '512m',
      '--cpus', '1.0',
      '--pids-limit', '100',
      '-v', `${mountPath}:/app:rw`,
      '-w', '/app',
      this.imageName,
    ];

    if (this.languageName === 'cpp') {
      compileArgs.push('g++', '-O2', '-std=c++17', '-Wall', 'solution.cpp', '-o', 'solution');
    } else if (this.languageName === 'java') {
      compileArgs.push('javac', 'Solution.java');
    } else if (this.languageName === 'python') {
      compileArgs.push('python3', '-m', 'py_compile', 'solution.py');
    } else {
      return this.innerRunner.compile({ workspaceDir, timeoutMs });
    }

    const result = await this.executeProcess({
      cmd: 'docker',
      args: compileArgs,
      cwd: workspaceDir,
      timeoutMs: timeoutMs + 3000,
    });

    // Check if Docker daemon is unreachable
    if (this.isDockerDaemonError(result.stderr || result.stdout) || result.exitCode === -1) {
      markDockerUnreachable(result.stderr || 'Connection failed');
      return this.innerRunner.compile({ workspaceDir, timeoutMs });
    }

    markDockerHealthy();

    if (result.timedOut) {
      return {
        isSuccess: false,
        errorMessage: 'Compilation Time Limit Exceeded (Docker)',
      };
    }

    if (result.exitCode !== 0) {
      return {
        isSuccess: false,
        errorMessage: this.innerRunner.sanitizeErrorMessage(result.stderr || result.stdout || 'Compilation failed inside container.'),
      };
    }

    return {
      isSuccess: true,
      errorMessage: null,
    };
  }

  /**
   * Run test case inside secure, capability-stripped Docker container
   */
  async run({ workspaceDir, inputData = '', timeLimitMs = 2000, memoryLimitMb = 256 }) {
    if (!shouldAttemptDocker()) {
      return this.innerRunner.run({ workspaceDir, inputData, timeLimitMs, memoryLimitMb });
    }

    const mountPath = this.getMountPath(workspaceDir);
    const memoryLimit = `${memoryLimitMb}m`;

    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      '--network', 'none',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--memory', memoryLimit,
      '--cpus', '1.0',
      '--pids-limit', '64',
      '-v', `${mountPath}:/app:rw`,
      '-w', '/app',
      this.imageName,
    ];

    if (this.languageName === 'cpp') {
      dockerArgs.push('./solution');
    } else if (this.languageName === 'java') {
      dockerArgs.push('java', `-Xmx${memoryLimitMb}m`, 'Solution');
    } else if (this.languageName === 'python') {
      dockerArgs.push('python3', 'solution.py');
    }

    const result = await this.executeProcess({
      cmd: 'docker',
      args: dockerArgs,
      cwd: workspaceDir,
      input: inputData,
      timeoutMs: timeLimitMs + 3000,
      maxOutputBytes: 512 * 1024,
    });

    // Check if Docker daemon is unreachable
    if (this.isDockerDaemonError(result.stderr || result.stdout) || result.exitCode === -1) {
      markDockerUnreachable(result.stderr || 'Connection failed');
      return this.innerRunner.run({ workspaceDir, inputData, timeLimitMs, memoryLimitMb });
    }

    markDockerHealthy();

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
        stderr: 'Output Limit Exceeded',
        executionTimeMs: result.executionTimeMs,
        memoryUsedKb: result.memoryUsedKb,
      };
    }

    if (result.exitCode !== 0) {
      return {
        status: 'runtime_error',
        stdout: result.stdout,
        stderr: this.innerRunner.sanitizeErrorMessage(result.stderr || `Runtime Error (exit code ${result.exitCode})`),
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
}

module.exports = DockerRunner;