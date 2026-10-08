/**
 * Request Validation Middleware for Submissions and Test Cases
 */

/**
 * Validate Test Case creation payload
 */
const validateCreateTestCase = (req, res, next) => {
  const { inputData, expectedOutput, isHidden, isSample, timeLimitMs, memoryLimitMb, testOrder } = req.body;

  if (expectedOutput === undefined || expectedOutput === null) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: expectedOutput is required',
    });
  }

  // Prevent oversized input/output payload injection (5MB max)
  const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;
  if (typeof inputData === 'string' && inputData.length > MAX_PAYLOAD_SIZE) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: inputData size exceeds 5MB limit',
    });
  }
  if (typeof expectedOutput === 'string' && expectedOutput.length > MAX_PAYLOAD_SIZE) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: expectedOutput size exceeds 5MB limit',
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
  } else if (isSample !== undefined) {
    req.body.isHidden = !Boolean(isSample);
  }

  if (testOrder !== undefined) {
    req.body.testOrder = parseInt(testOrder, 10) || 1;
  }

  // Strip client injection attempts
  delete req.body.id;

  next();
};

/**
 * Validate Test Case update payload
 */
const validateUpdateTestCase = (req, res, next) => {
  const { inputData, expectedOutput, isHidden, isSample, timeLimitMs, memoryLimitMb, testOrder } = req.body;

  const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;
  if (inputData !== undefined && typeof inputData === 'string' && inputData.length > MAX_PAYLOAD_SIZE) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: inputData size exceeds 5MB limit',
    });
  }
  if (expectedOutput !== undefined) {
    if (expectedOutput === null) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: expectedOutput cannot be null',
      });
    }
    if (typeof expectedOutput === 'string' && expectedOutput.length > MAX_PAYLOAD_SIZE) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: expectedOutput size exceeds 5MB limit',
      });
    }
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
  } else if (isSample !== undefined) {
    req.body.isHidden = !Boolean(isSample);
  }

  if (testOrder !== undefined) {
    req.body.testOrder = parseInt(testOrder, 10) || 1;
  }

  // Prevent modifying immutable foreign key or primary key
  delete req.body.id;
  delete req.body.problemId;
  delete req.body.problem_id;

  next();
};

/**
 * Validate Submission payload
 */
const validateCreateSubmission = (req, res, next) => {
  const { contestId, problemId, language, sourceCode, codingMode } = req.body;

  if (contestId !== undefined && contestId !== null && contestId !== '') {
    const num = Number(contestId);
    if (!Number.isInteger(num) || num <= 0 || num > 2147483647) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: contestId must be a valid positive integer',
      });
    }
    req.body.contestId = num;
  } else {
    req.body.contestId = null;
  }

  if (problemId === undefined || problemId === null || problemId === '') {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: problemId is required',
    });
  }

  const numProb = Number(problemId);
  if (!Number.isInteger(numProb) || numProb <= 0 || numProb > 2147483647) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: problemId must be a valid positive integer',
    });
  }
  req.body.problemId = numProb;

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

  // Strip client injection attempts (verdict, score, user identity, etc.)
  delete req.body.userId;
  delete req.body.user_id;
  delete req.body.studentId;
  delete req.body.student_id;
  delete req.body.participantId;
  delete req.body.participant_id;
  delete req.body.score;
  delete req.body.status;
  delete req.body.result;
  delete req.body.verdict;
  delete req.body.executionTime;
  delete req.body.execution_time;
  delete req.body.runtime;
  delete req.body.memoryUsed;
  delete req.body.memory_used;
  delete req.body.memory;
  delete req.body.testCasesPassed;
  delete req.body.test_cases_passed;
  delete req.body.testCasesTotal;
  delete req.body.test_cases_total;
  delete req.body.isTestDate;
  delete req.body.is_test_data;

  next();
};

module.exports = {
  validateCreateTestCase,
  validateUpdateTestCase,
  validateCreateSubmission,
};