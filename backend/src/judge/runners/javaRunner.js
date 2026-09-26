const path = require('path');
const fs = require('fs');
const BaseRunner = require('./baseRunner');

let cachedJavac = null;
let cachedJava = null;

function findJavaBinary(binaryName) {
  // Ordered list of directories to search for JDK installations
  const searchDirs = [
    'C:\\java',                              // Custom/portable installs (e.g. C:\java\basic\OpenJDK-24)
    'C:\\Program Files\\Java',               // Oracle JDK
    'C:\\Program Files\\Microsoft',          // Microsoft Build of OpenJDK
    'C:\\Program Files\\Eclipse Adoptium',   // Adoptium Temurin
    'C:\\Program Files\\Eclipse Foundation', // Eclipse JDK
    'C:\\Program Files\\Zulu',               // Azul Zulu
    'C:\\Program Files\\Amazon Corretto',    // Amazon Corretto
    'C:\\Program Files (x86)\\Java',         // 32-bit Oracle
  ];
  for (const baseDir of searchDirs) {
    try {
      if (!fs.existsSync(baseDir)) continue;
      // Walk up to 3 levels deep to handle nested structures like C:\java\basic\OpenJDK-24\bin
      const walk = (dir, depth) => {
        if (depth < 0) return null;
        const binPath = path.join(dir, 'bin', binaryName);
        if (fs.existsSync(binPath)) return binPath;
        try {
          for (const entry of fs.readdirSync(dir)) {
            const sub = path.join(dir, entry);
            if (fs.statSync(sub).isDirectory()) {
              const found = walk(sub, depth - 1);
              if (found) return found;
            }
          }
        } catch (_) {}
        return null;
      };
      const found = walk(baseDir, 2);
      if (found) return found;
    } catch (_) {}
  }
  return null;
}

function resolveJavac() {
  if (cachedJavac) return cachedJavac;
  if (process.env.JAVAC_PATH && fs.existsSync(process.env.JAVAC_PATH)) {
    cachedJavac = process.env.JAVAC_PATH;
    return cachedJavac;
  }
  cachedJavac = findJavaBinary('javac.exe') || 'javac';
  return cachedJavac;
}

function resolveJava() {
  if (cachedJava) return cachedJava;
  if (process.env.JAVA_PATH && fs.existsSync(process.env.JAVA_PATH)) {
    cachedJava = process.env.JAVA_PATH;
    return cachedJava;
  }
  cachedJava = findJavaBinary('java.exe') || 'java';
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

  async run({ workspaceDir, inputData = '', timeLimitMs = 3000, memoryLimitMb = 256, entryClass = null }) {
    const javaCmd = resolveJava();

    // In function mode with test harnesses, the driver main method resides in Main.class.
    // In standard coding mode or fallback harness, the main method is in Solution.class.
    const targetClass = entryClass || (fs.existsSync(path.join(workspaceDir, 'Main.class')) ? 'Main' : 'Solution');

    const result = await this.executeProcess({
      cmd: javaCmd,
      args: [`-Xmx${memoryLimitMb}m`, '-cp', '.', targetClass],
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