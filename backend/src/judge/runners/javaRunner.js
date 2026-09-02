const path = require('path');
const fs = require('fs');
const BaseRunner = require('./baseRunner');

let cachedJavac = null;
let cachedJava = null;

function resolveJavac() {
  if (cachedJavac) return cachedJavac;
  if (process.env.JAVAC_PATH && fs.existsSync(process.env.JAVAC_PATH)) {
    cachedJavac = process.env.JAVAC_PATH;
    return cachedJavac;
  }
  try {
    const msDir = 'C:\\Program Files\\Microsoft';
    if (fs.existsSync(msDir)) {
      const entries = fs.readdirSync(msDir);
      for (const e of entries) {
        const j = path.join(msDir, e, 'bin', 'javac.exe');
        if (fs.existsSync(j)) {
          cachedJavac = j;
          return cachedJavac;
        }
      }
    }
    const javaDir = 'C:\\Program Files\\Java';
    if (fs.existsSync(javaDir)) {
      const entries = fs.readdirSync(javaDir);
      for (const e of entries) {
        const j = path.join(javaDir, e, 'bin', 'javac.exe');
        if (fs.existsSync(j)) {
          cachedJavac = j;
          return cachedJavac;
        }
      }
    }
  } catch (e) {}
  cachedJavac = 'javac';
  return cachedJavac;
}

function resolveJava() {
  if (cachedJava) return cachedJava;
  if (process.env.JAVA_PATH && fs.existsSync(process.env.JAVA_PATH)) {
    cachedJava = process.env.JAVA_PATH;
    return cachedJava;
  }
  try {
    const msDir = 'C:\\Program Files\\Microsoft';
    if (fs.existsSync(msDir)) {
      const entries = fs.readdirSync(msDir);
      for (const e of entries) {
        const j = path.join(msDir, e, 'bin', 'java.exe');
        if (fs.existsSync(j)) {
          cachedJava = j;
          return cachedJava;
        }
      }
    }
    const javaDir = 'C:\\Program Files\\Java';
    if (fs.existsSync(javaDir)) {
      const entries = fs.readdirSync(javaDir);
      for (const e of entries) {
        const j = path.join(javaDir, e, 'bin', 'java.exe');
        if (fs.existsSync(j)) {
          cachedJava = j;
          return cachedJava;
        }
      }
    }
  } catch (e) {}
  cachedJava = 'java';
  return cachedJava;
}

/**
 * JavaRunner - Handles Java compilation and JVM execution
 */
class JavaRunner extends BaseRunner {
  constructor() {
    super('java', 'Solution.java');
  }

  async compile({ workspaceDir, timeoutMs = 10000 }) {
    const sourcePath = path.join(workspaceDir, this.sourceFileName);
    const javacCmd = resolveJavac();

    const result = await this.executeProcess({
      cmd: javacCmd,
      args: [sourcePath],
      cwd: workspaceDir,
      timeoutMs,
    });

    if (result.timedOut) {
      return {
        isSuccess: false,
        errorMessage: 'Java Compilation Time Limit Exceeded',
      };
    }

    const classPath = path.join(workspaceDir, 'Solution.class');
    if (result.exitCode !== 0 || !fs.existsSync(classPath)) {
      return {
        isSuccess: false,
        errorMessage: this.sanitizeErrorMessage(result.stderr || 'Java compilation failed.'),
      };
    }

    return {
      isSuccess: true,
      errorMessage: null,
    };
  }

  async run({ workspaceDir, inputData = '', timeLimitMs = 3000, memoryLimitMb = 256 }) {
    const javaCmd = resolveJava();

    const result = await this.executeProcess({
      cmd: javaCmd,
      args: [`-Xmx${memoryLimitMb}m`, '-cp', '.', 'Solution'],
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
        stderr: this.sanitizeErrorMessage(result.stderr || `Java Runtime Exception (exit code ${result.exitCode})`),
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
      .replace(/.*[\\\/]Solution\.java/g, 'Solution.java')
      .replace(/C:\\.*\\temp\\.*\\/gi, '')
      .replace(/\/tmp\/.*\/Solution\.java/g, 'Solution.java')
      .trim();
  }
}

module.exports = JavaRunner;