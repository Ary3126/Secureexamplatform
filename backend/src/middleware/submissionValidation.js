/**
 * Request Validation Middleware for Submissions and Test Cases
 */

/**
 * Validate Test Case creation payload
 */
const validateCreateTestCase = (req, res, next) => {
  const { inputData, expectedOutput, isHidden, timeLimitMs, memoryLimitMb, testOrder } = req.body;

  if (expectedOutput === undefined || expectedOutput === null) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: expectedOutput is required',
    });
  }

  if (timeLimitMs !== undefined) {
    const parsedTime = parseInt(timeLimitMs, 10);
    if (isNaN(parsedTime) || parsedTime <= 0 || parsedTime > 15000) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: timeLimitMs must be between 1 and 15000 milliseconds',
      });
    }
    req.body.timeLimitMs = parsedTime;
  }

  if (memoryLimitMb !== undefined) {
    const parsedMem = parseInt(memoryLimitMb, 10);
    if (isNaN(parsedMem) || parsedMem <= 0 || parsedMem > 1024) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: memoryLimitMb must be between 1 and 1024 MB',
      });
    }
    req.body.memoryLimitMb = parsedMem;
  }

  if (isHidden !== undefined) {
    req.body.isHidden = Boolean(isHidden);
  }

  if (testOrder !== undefined) {
    req.body.testOrder = parseInt(testOrder, 10) || 1;
  }

  next();
};

/**
 * Validate Submission payload
 */
const validateCreateSubmission = (req, res, next) => {
  const { contestId, problemId, language, sourceCode, codingMode } = req.body;

  if (contestId !== undefined && contestId !== null && contestId !== '') {
    const parsedContestId = parseInt(contestId, 10);
    if (isNaN(parsedContestId) || parsedContestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: contestId must be a valid positive integer',
      });
    }
    req.body.contestId = parsedContestId;
  } else {
    req.body.contestId = null;
  }

  if (!problemId) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: problemId is required',
    });
  }

  const parsedProblemId = parseInt(problemId, 10);
  if (isNaN(parsedProblemId) || parsedProblemId <= 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: problemId must be a valid positive integer',
    });
  }
  req.body.problemId = parsedProblemId;

  if (!language || typeof language !== 'string') {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: language is required',
    });
  }

  const supported = ['cpp', 'python', 'java', 'c', 'javascript'];
  const langKey = language.toLowerCase().trim();
  if (!supported.includes(langKey)) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: `Validation failed: Language '${language}' is not supported. Allowed: ${supported.join(', ')}`,
    });
  }
  req.body.language = langKey === 'c' ? 'cpp' : langKey;

  if (codingMode) {
    const validModes = ['full_program', 'function'];
    if (!validModes.includes(codingMode.toLowerCase().trim())) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Validation failed: codingMode must be one of: ${validModes.join(', ')}`,
      });
    }
    req.body.codingMode = codingMode.toLowerCase().trim();
  }

  if (!sourceCode || typeof sourceCode !== 'string' || sourceCode.trim().length === 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: sourceCode is required and cannot be empty',
    });
  }

  if (sourceCode.length > 65536) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: Source code size exceeds maximum limit of 64KB',
    });
  }

  // Strip client injection attempts
  delete req.body.userId;
  delete req.body.user_id;
  delete req.body.score;
  delete req.body.status;
  delete req.body.executionTime;
  delete req.body.execution_time;
  delete req.body.memoryUsed;
  delete req.body.memory_used;

  next();
};

module.exports = {
  validateCreateTestCase,
  validateCreateSubmission,
};