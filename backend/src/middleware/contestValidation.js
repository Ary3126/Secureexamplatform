/**
 * Request validation middlewares for Contest and Problem management endpoints
 */

const isValidDate = (dateString) => {
  if (!dateString || typeof dateString !== 'string') return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

/**
 * Validate contest creation payload
 */
const validateCreateContest = (req, res, next) => {
  const { title, startTime, endTime, description } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
    errors.push('Contest title is required and must be between 3 and 200 characters.');
  }

  if (!startTime || !isValidDate(startTime)) {
    errors.push('A valid start time (ISO 8601 string) is required.');
  }

  if (!endTime || !isValidDate(endTime)) {
    errors.push('A valid end time (ISO 8601 string) is required.');
  }

  if (startTime && endTime && isValidDate(startTime) && isValidDate(endTime)) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end <= start) {
      errors.push('Contest end time must be later than the start time.');
    }
  }

  if (description !== undefined && typeof description !== 'string') {
    errors.push('Description must be a valid text string.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Contest validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validate contest update payload
 */
const validateUpdateContest = (req, res, next) => {
  const { title, startTime, endTime, description, isRated, leaderboardFreezeEnabled, leaderboardFreezeMinutes, status } = req.body;
  const errors = [];

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
      errors.push('Contest title must be between 3 and 200 characters.');
    }
  }

  if (startTime !== undefined && !isValidDate(startTime)) {
    errors.push('Provided start time must be a valid ISO 8601 date string.');
  }

  if (endTime !== undefined && !isValidDate(endTime)) {
    errors.push('Provided end time must be a valid ISO 8601 date string.');
  }

  if (startTime !== undefined && endTime !== undefined && isValidDate(startTime) && isValidDate(endTime)) {
    if (new Date(endTime) <= new Date(startTime)) {
      errors.push('Contest end time must be later than the start time.');
    }
  }

  if (description !== undefined && typeof description !== 'string') {
    errors.push('Description must be a valid text string.');
  }

  if (
    title === undefined &&
    startTime === undefined &&
    endTime === undefined &&
    description === undefined &&
    isRated === undefined &&
    leaderboardFreezeEnabled === undefined &&
    leaderboardFreezeMinutes === undefined &&
    status === undefined
  ) {
    errors.push('Please provide at least one field to update.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Contest update validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validate problem creation payload
 */
const validateCreateProblem = (req, res, next) => {
  const { title, description, difficulty } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
    errors.push('Problem title is required and must be between 3 and 200 characters.');
  }

  if (!description || typeof description !== 'string' || description.trim().length < 5) {
    errors.push('Problem description is required and must be at least 5 characters long.');
  }

  const validDifficulties = ['easy', 'medium', 'hard'];
  if (!difficulty || typeof difficulty !== 'string' || !validDifficulties.includes(difficulty.toLowerCase())) {
    errors.push('Difficulty is required and must be one of: easy, medium, hard.');
  }

  const effectiveCodingMode = req.body.codingMode !== undefined ? req.body.codingMode : req.body.coding_mode;
  if (effectiveCodingMode !== undefined) {
    const validModes = ['full_program', 'function'];
    if (typeof effectiveCodingMode !== 'string' || !validModes.includes(effectiveCodingMode.toLowerCase())) {
      errors.push('codingMode must be one of: full_program, function.');
    }
  }

  const effectiveAccessScope = req.body.accessScope !== undefined ? req.body.accessScope : req.body.access_scope;
  if (effectiveAccessScope !== undefined) {
    const validScopes = ['public', 'contest_private', 'class', 'institution'];
    if (typeof effectiveAccessScope !== 'string' || !validScopes.includes(effectiveAccessScope.toLowerCase())) {
      errors.push('accessScope must be one of: public, contest_private, class, institution.');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Problem validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validate problem update payload
 */
const validateUpdateProblem = (req, res, next) => {
  const { title, description, difficulty } = req.body;
  const errors = [];

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
      errors.push('Problem title must be between 3 and 200 characters.');
    }
  }

  if (description !== undefined) {
    if (typeof description !== 'string' || description.trim().length < 5) {
      errors.push('Problem description must be at least 5 characters long.');
    }
  }

  if (difficulty !== undefined) {
    const validDifficulties = ['easy', 'medium', 'hard'];
    if (typeof difficulty !== 'string' || !validDifficulties.includes(difficulty.toLowerCase())) {
      errors.push('Difficulty must be one of: easy, medium, hard.');
    }
  }

  const effectiveCodingMode = req.body.codingMode !== undefined ? req.body.codingMode : req.body.coding_mode;
  if (effectiveCodingMode !== undefined) {
    const validModes = ['full_program', 'function'];
    if (typeof effectiveCodingMode !== 'string' || !validModes.includes(effectiveCodingMode.toLowerCase())) {
      errors.push('codingMode must be one of: full_program, function.');
    }
  }

  const effectiveAccessScope = req.body.accessScope !== undefined ? req.body.accessScope : req.body.access_scope;
  if (effectiveAccessScope !== undefined) {
    const validScopes = ['public', 'contest_private', 'class', 'institution'];
    if (typeof effectiveAccessScope !== 'string' || !validScopes.includes(effectiveAccessScope.toLowerCase())) {
      errors.push('accessScope must be one of: public, contest_private, class, institution.');
    }
  }

  const hasAnyField = (
    title !== undefined ||
    description !== undefined ||
    difficulty !== undefined ||
    effectiveCodingMode !== undefined ||
    effectiveAccessScope !== undefined ||
    req.body.starterTemplates !== undefined ||
    req.body.starter_templates !== undefined ||
    req.body.harnessTemplates !== undefined ||
    req.body.harness_templates !== undefined
  );

  if (!hasAnyField) {
    errors.push('Please provide at least one field to update (title, description, difficulty, codingMode, starterTemplates, harnessTemplates, accessScope).');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Problem update validation failed',
      errors,
    });
  }

  next();
};

/**
 * Validate problem assignment to contest
 */
const validateAddProblemToContest = (req, res, next) => {
  const { problemId, problemOrder, points } = req.body;
  const errors = [];

  if (problemId === undefined || isNaN(parseInt(problemId, 10)) || parseInt(problemId, 10) <= 0) {
    errors.push('A valid positive integer problemId is required.');
  }

  if (problemOrder !== undefined && (isNaN(parseInt(problemOrder, 10)) || parseInt(problemOrder, 10) <= 0)) {
    errors.push('Problem order must be a positive integer.');
  }

  if (points !== undefined && (isNaN(parseInt(points, 10)) || parseInt(points, 10) <= 0)) {
    errors.push('Points must be a positive integer.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed for adding problem to contest',
      errors,
    });
  }

  next();
};

module.exports = {
  validateCreateContest,
  validateUpdateContest,
  validateCreateProblem,
  validateUpdateProblem,
  validateAddProblemToContest,
};
