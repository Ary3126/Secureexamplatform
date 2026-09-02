const path = require('path');
const os = require('os');

/**
 * SecurityPreconditions - Fail-closed precondition validator for judge execution
 */
class SecurityPreconditions {
  /**
   * Validate execution parameters and ensure security invariant checks pass
   * @param {Object} options
   * @throws {Error} if any security precondition fails
   */
  static validate({
    submissionId,
    language,
    sourceCode,
    timeLimitMs,
    memoryLimitMb,
    workspaceDir,
  }) {
    // 1. Language validation
    const allowedLanguages = ['cpp', 'python', 'java'];
    if (!language || !allowedLanguages.includes(language.toLowerCase().trim())) {
      throw new Error(`[SECURITY PRECONDITION FAILED] Unsupported or prohibited language: '${language}'`);
    }

    // 2. Source code size bound
    if (!sourceCode || typeof sourceCode !== 'string') {
      throw new Error('[SECURITY PRECONDITION FAILED] Source code must be a non-empty string.');
    }
    const MAX_SOURCE_BYTES = 64 * 1024; // 64 KB
    if (Buffer.byteLength(sourceCode, 'utf8') > MAX_SOURCE_BYTES) {
      throw new Error(`[SECURITY PRECONDITION FAILED] Source code size exceeds safety limit of ${MAX_SOURCE_BYTES} bytes.`);
    }

    // 3. Time limit bounds
    const MAX_TIME_MS = 15000;
    if (timeLimitMs !== undefined) {
      if (typeof timeLimitMs !== 'number' || isNaN(timeLimitMs) || timeLimitMs <= 0 || timeLimitMs > MAX_TIME_MS) {
        throw new Error(`[SECURITY PRECONDITION FAILED] Time limit must be between 1 and ${MAX_TIME_MS} ms.`);
      }
    }

    // 4. Memory limit bounds
    const MAX_MEMORY_MB = 1024;
    if (memoryLimitMb !== undefined) {
      if (typeof memoryLimitMb !== 'number' || isNaN(memoryLimitMb) || memoryLimitMb <= 0 || memoryLimitMb > MAX_MEMORY_MB) {
        throw new Error(`[SECURITY PRECONDITION FAILED] Memory limit must be between 1 and ${MAX_MEMORY_MB} MB.`);
      }
    }

    // 5. Workspace path safety (must be inside designated secure temp directory)
    if (workspaceDir) {
      const resolvedWorkspace = path.resolve(workspaceDir);
      const baseTempDir = path.resolve(os.tmpdir(), 'secure_judge');
      if (!resolvedWorkspace.startsWith(baseTempDir)) {
        throw new Error(`[SECURITY PRECONDITION FAILED] Workspace directory path traversal violation: '${workspaceDir}' is outside safe temp boundary.`);
      }
    }

    return true;
  }
}

module.exports = SecurityPreconditions;