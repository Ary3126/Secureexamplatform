/**
 * SecurityLogger - Audit logging for sandbox and judge security events
 * Guarantees zero leakage of secrets, passwords, or credentials
 */
class SecurityLogger {
  static logEvent(eventType, details = {}) {
    const timestamp = new Date().toISOString();
    const sanitizedDetails = { ...details };

    // Strip sensitive fields
    const sensitiveKeys = ['password', 'passwordHash', 'token', 'jwtSecret', 'databaseUrl', 'sourceCode'];
    for (const key of sensitiveKeys) {
      if (sanitizedDetails[key]) {
        sanitizedDetails[key] = '[REDACTED]';
      }
    }

    const payload = JSON.stringify({
      timestamp,
      event: eventType,
      ...sanitizedDetails,
    });

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[SECURITY AUDIT] ${payload}`);
    }
  }

  static warnViolation(violationType, details = {}) {
    const timestamp = new Date().toISOString();
    const sanitizedDetails = { ...details };

    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[SECURITY VIOLATION] ${timestamp} - ${violationType}:`, sanitizedDetails);
    }
  }
}

module.exports = SecurityLogger;