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
  const {
    title,
    startTime,
    endTime,
    description,
    accessScope,
    visibility,
    isRated,
    leaderboardFreezeEnabled,
    leaderboardFreezeMinutes,
    durationMinutes,
  } = req.body;
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
    } else {
      const diffMins = (end.getTime() - start.getTime()) / 60000;
      if (diffMins < 1) {
        errors.push('Contest duration must be at least 1 minute.');
      }
    }
  }

  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      errors.push('Description must be a valid text string.');
    } else if (description.trim().length > 10000) {
      errors.push('Description cannot exceed 10000 characters.');
    }
  }

  if (accessScope !== undefined && accessScope !== null) {
    if (typeof accessScope !== 'string' || !['public', 'private', 'restricted'].includes(accessScope.toLowerCase())) {
      errors.push('Invalid access scope. Allowed values: public, private, restricted.');
    }
  }

  if (visibility !== undefined && visibility !== null) {
    if (typeof visibility !== 'string' || !['public', 'private', 'restricted'].includes(visibility.toLowerCase())) {
      errors.push('Invalid visibility. Allowed values: public, private, restricted.');
    }
  }

  if (isRated !== undefined && isRated !== null) {
    if (typeof isRated !== 'boolean') {
      errors.push('isRated must be a boolean value.');
    }
  }

  if (leaderboardFreezeEnabled !== undefined && leaderboardFreezeEnabled !== null) {
    if (typeof leaderboardFreezeEnabled !== 'boolean') {
      errors.push('leaderboardFreezeEnabled must be a boolean value.');
    }
  }

  if (leaderboardFreezeMinutes !== undefined && leaderboardFreezeMinutes !== null) {
    const freezeMins = typeof leaderboardFreezeMinutes === 'number'
      ? leaderboardFreezeMinutes
      : Number(leaderboardFreezeMinutes);
    if (isNaN(freezeMins) || !Number.isInteger(freezeMins) || freezeMins < 0) {
      errors.push('leaderboardFreezeMinutes must be a non-negative integer.');
    } else if (startTime && endTime && isValidDate(startTime) && isValidDate(endTime)) {
      const durationMins = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000;
      if (freezeMins > durationMins) {
        errors.push('Leaderboard freeze duration cannot exceed the total contest duration.');
      }
    }
  }

  if (durationMinutes !== undefined && durationMinutes !== null) {
    const dm = Number(durationMinutes);
    if (isNaN(dm) || dm <= 0) {
      errors.push('durationMinutes must be a positive integer.');
    }
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

  if (isRated !== undefined && typeof isRated !== 'boolean') {
    errors.push('isRated must be a boolean value.');
  }

  if (leaderboardFreezeEnabled !== undefined && typeof leaderboardFreezeEnabled !== 'boolean') {
    errors.push('leaderboardFreezeEnabled must be a boolean value.');
  }

  if (leaderboardFreezeMinutes !== undefined && leaderboardFreezeMinutes !== null) {
    const freezeMins = typeof leaderboardFreezeMinutes === 'number'
      ? leaderboardFreezeMinutes
      : Number(leaderboardFreezeMinutes);
    if (isNaN(freezeMins) || !Number.isInteger(freezeMins) || freezeMins < 0) {
      errors.push('leaderboardFreezeMinutes must be a non-negative integer.');
    } else if (startTime && endTime && isValidDate(startTime) && isValidDate(endTime)) {
      const durationMins = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000;
      if (freezeMins > durationMins) {
        errors.push('Leaderboard freeze duration cannot exceed the total contest duration.');
      }
    }
  }

  if (status !== undefined) {
    const validStatuses = ['draft', 'published', 'archived'];
    if (!validStatuses.includes(status)) {
      errors.push(`Invalid contest status: '${status}'. Status must be one of: ${validStatuses.join(', ')}.`);
    }
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

const SUPPORTED_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c'];

/**
 * Validate starter and harness template objects
 */
const validateTemplates = (templates, fieldName, errors, codingMode = 'full_program') => {
  if (templates === undefined || templates === null) return;
  if (typeof templates !== 'object' || Array.isArray(templates)) {
    errors.push(`${fieldName} must be a valid key-value object of language templates.`);
    return;
  }
  for (const [lang, code] of Object.entries(templates)) {
    if (!SUPPORTED_LANGUAGES.includes(lang.toLowerCase())) {
      errors.push(`Unsupported language "${lang}" in ${fieldName}. Supported languages are: ${SUPPORTED_LANGUAGES.join(', ')}.`);
    } else if (typeof code !== 'string') {
      errors.push(`Template for language "${lang}" in ${fieldName} must be a string.`);
    } else if (fieldName === 'harnessTemplates' && codingMode === 'function' && code.trim().length > 0) {
      if (!code.includes('__STUDENT_CODE__')) {
        errors.push(`Harness template for ${lang} must include the // __STUDENT_CODE__ placeholder.`);
      }
    }
  }
};

/**
 * Validate allowed languages list
 */
const validateAllowedLanguages = (allowedLanguages, errors) => {
  if (allowedLanguages === undefined || allowedLanguages === null) return;
  if (!Array.isArray(allowedLanguages)) {
    errors.push('allowedLanguages must be an array of language identifiers.');
    return;
  }
  if (allowedLanguages.length === 0) {
    errors.push('At least one language must be enabled for the problem.');
    return;
  }
  const seen = new Set();
  for (const lang of allowedLanguages) {
    if (typeof lang !== 'string') {
      errors.push('Each language in allowedLanguages must be a string.');
      continue;
    }
    const norm = lang.toLowerCase().trim();
    if (!SUPPORTED_LANGUAGES.includes(norm)) {
      errors.push(`Unsupported language "${lang}" in allowedLanguages. Supported languages are: ${SUPPORTED_LANGUAGES.join(', ')}.`);
    } else if (seen.has(norm)) {
      errors.push(`Duplicate language "${lang}" in allowedLanguages.`);
    } else {
      seen.add(norm);
    }
  }
};

/**
 * Validate Function Mode function configuration (DSL definition)
 */
const validateFunctionConfig = (config, codingMode, errors) => {
  if (config === undefined || config === null) return;

  if (typeof config !== 'object' || Array.isArray(config)) {
    errors.push('functionConfig must be a valid object.');
    return;
  }

  const { functionName, returnType, parameters } = config;

  if (codingMode === 'function' || functionName !== undefined) {
    if (!functionName || typeof functionName !== 'string' || functionName.trim().length === 0) {
      errors.push('Function name is required in Function Mode.');
    } else {
      const trimmedName = functionName.trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
        errors.push(`Function name "${trimmedName}" must be a valid identifier (alphanumeric and underscores only, starting with a letter or underscore).`);
      } else if (trimmedName.length > 64) {
        errors.push('Function name must not exceed 64 characters.');
      }
    }
  }

  if (codingMode === 'function' && returnType !== undefined) {
    if (typeof returnType !== 'string' || returnType.trim().length === 0) {
      errors.push('Return type is required in Function Mode.');
    } else if (returnType.trim().length > 64) {
      errors.push('Return type must not exceed 64 characters.');
    }
  }

  if (parameters !== undefined && parameters !== null) {
    if (Array.isArray(parameters)) {
      if (parameters.length > 50) {
        errors.push('Too many parameters (maximum 50 parameters allowed).');
      }
      const seenNames = new Set();
      for (let i = 0; i < parameters.length; i++) {
        const param = parameters[i];
        if (!param || typeof param !== 'object' || Array.isArray(param)) {
          errors.push(`Parameter ${i + 1} must be an object with name and type.`);
          continue;
        }

        const pName = typeof param.name === 'string' ? param.name.trim() : '';
        const pType = typeof param.type === 'string' ? param.type.trim() : '';

        if (!pName) {
          errors.push(`Parameter ${i + 1} is missing a parameter name.`);
        } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pName)) {
          errors.push(`Parameter name "${pName}" must be a valid identifier (alphanumeric and underscores only).`);
        } else if (seenNames.has(pName.toLowerCase())) {
          errors.push(`Duplicate parameter name "${pName}". Parameter names must be unique.`);
        } else {
          seenNames.add(pName.toLowerCase());
        }

        if (!pType) {
          errors.push(`Parameter "${pName || i + 1}" is missing a parameter type.`);
        } else if (pType.length > 64) {
          errors.push(`Parameter "${pName || i + 1}" type must not exceed 64 characters.`);
        } else if (!/^[a-zA-Z0-9_\[\]\s*&<>,]+$/.test(pType)) {
          errors.push(`Parameter "${pName || i + 1}" type contains invalid characters.`);
        }
      }
    } else if (typeof parameters === 'string') {
      const trimmedParams = parameters.trim();
      if (trimmedParams.length > 0) {
        const parts = trimmedParams.split(',').map((p) => p.trim()).filter(Boolean);
        const seenNames = new Set();
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const tokens = part.split(/\s+/).filter(Boolean);
          if (tokens.length < 2) {
            errors.push(`Parameter ${i + 1} ("${part}") is missing a parameter name.`);
          } else {
            const rawName = tokens[tokens.length - 1].replace(/^[&*]+/, '');
            const rawType = tokens.slice(0, tokens.length - 1).join(' ');

            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawName)) {
              errors.push(`Parameter name "${rawName}" must be a valid identifier.`);
            } else if (seenNames.has(rawName.toLowerCase())) {
              errors.push(`Duplicate parameter name "${rawName}". Parameter names must be unique.`);
            } else {
              seenNames.add(rawName.toLowerCase());
            }

            if (!rawType) {
              errors.push(`Parameter "${rawName}" is missing a parameter type.`);
            }
          }
        }
      }
    } else {
      errors.push('Parameters must be an array of parameter objects or a comma-separated parameter string.');
    }
  }
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
  } else if (description.length > 100000) {
    errors.push('Problem description must not exceed 100,000 characters.');
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

  const effectiveStarterTemplates = req.body.starterTemplates !== undefined ? req.body.starterTemplates : req.body.starter_templates;
  if (effectiveStarterTemplates !== undefined) {
    validateTemplates(effectiveStarterTemplates, 'starterTemplates', errors, effectiveCodingMode);
  }

  const effectiveHarnessTemplates = req.body.harnessTemplates !== undefined ? req.body.harnessTemplates : req.body.harness_templates;
  if (effectiveHarnessTemplates !== undefined) {
    validateTemplates(effectiveHarnessTemplates, 'harnessTemplates', errors, effectiveCodingMode);
  }

  const effectiveFunctionConfig = req.body.functionConfig !== undefined ? req.body.functionConfig : req.body.function_config;
  if (effectiveFunctionConfig !== undefined) {
    validateFunctionConfig(effectiveFunctionConfig, effectiveCodingMode, errors);
  }

  const effectiveAllowedLanguages = req.body.allowedLanguages !== undefined ? req.body.allowedLanguages : req.body.allowed_languages;
  if (effectiveAllowedLanguages !== undefined) {
    validateAllowedLanguages(effectiveAllowedLanguages, errors);
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
    } else if (description.length > 100000) {
      errors.push('Problem description must not exceed 100,000 characters.');
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

  const effectiveStarterTemplates = req.body.starterTemplates !== undefined ? req.body.starterTemplates : req.body.starter_templates;
  if (effectiveStarterTemplates !== undefined) {
    validateTemplates(effectiveStarterTemplates, 'starterTemplates', errors, effectiveCodingMode);
  }

  const effectiveHarnessTemplates = req.body.harnessTemplates !== undefined ? req.body.harnessTemplates : req.body.harness_templates;
  if (effectiveHarnessTemplates !== undefined) {
    validateTemplates(effectiveHarnessTemplates, 'harnessTemplates', errors, effectiveCodingMode);
  }

  const effectiveFunctionConfig = req.body.functionConfig !== undefined ? req.body.functionConfig : req.body.function_config;
  if (effectiveFunctionConfig !== undefined) {
    validateFunctionConfig(effectiveFunctionConfig, effectiveCodingMode, errors);
  }

  const effectiveAllowedLanguages = req.body.allowedLanguages !== undefined ? req.body.allowedLanguages : req.body.allowed_languages;
  if (effectiveAllowedLanguages !== undefined) {
    validateAllowedLanguages(effectiveAllowedLanguages, errors);
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
    req.body.harness_templates !== undefined ||
    req.body.functionConfig !== undefined ||
    req.body.function_config !== undefined ||
    req.body.allowedLanguages !== undefined ||
    req.body.allowed_languages !== undefined
  );

  if (!hasAnyField) {
    errors.push('Please provide at least one field to update (title, description, difficulty, codingMode, starterTemplates, harnessTemplates, functionConfig, allowedLanguages, accessScope).');
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
  const { problemId, problemOrder, points } = req.body || {};
  const errors = [];

  const rawContestId = req.params.contestId || req.params.id;
  const numContestId = Number(rawContestId);
  if (rawContestId !== undefined && (!Number.isInteger(numContestId) || numContestId <= 0)) {
    errors.push('A valid positive integer contest ID is required.');
  }

  const numProblemId = Number(problemId);
  if (problemId === undefined || !Number.isInteger(numProblemId) || numProblemId <= 0) {
    errors.push('A valid positive integer problemId is required.');
  }

  if (problemOrder !== undefined) {
    const numOrder = Number(problemOrder);
    if (!Number.isInteger(numOrder) || numOrder <= 0) {
      errors.push('Problem order must be a positive integer.');
    }
  }

  if (points !== undefined) {
    const numPoints = Number(points);
    if (!Number.isInteger(numPoints) || numPoints <= 0 || numPoints > 100000) {
      errors.push('Points must be a positive integer (max 100000).');
    }
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

/**
 * Validate bulk problem assignment to contest
 */
const validateBulkAddContestProblems = (req, res, next) => {
  const rawContestId = req.params.contestId || req.params.id;
  const errors = [];

  const numContestId = Number(rawContestId);
  if (rawContestId !== undefined && (!Number.isInteger(numContestId) || numContestId <= 0)) {
    errors.push('A valid positive integer contest ID is required.');
  }

  const { problems } = req.body || {};
  if (!problems || !Array.isArray(problems) || problems.length === 0) {
    errors.push('A non-empty array of problems is required.');
  } else if (problems.length > 100) {
    errors.push('Problems array exceeds maximum allowed limit of 100 items.');
  } else {
    const seen = new Set();
    for (let i = 0; i < problems.length; i++) {
      const item = problems[i];
      if (!item || typeof item !== 'object') {
        errors.push(`Invalid problem entry at index ${i}. Must be an object.`);
        continue;
      }
      const numPId = Number(item.problemId || item.id);
      if (!Number.isInteger(numPId) || numPId <= 0) {
        errors.push(`Invalid problemId at index ${i}. Must be a positive integer.`);
      } else if (seen.has(numPId)) {
        errors.push(`Duplicate problemId ${numPId} at index ${i}. Each problem must be unique.`);
      } else {
        seen.add(numPId);
      }
      if (item.points !== undefined) {
        const numPts = Number(item.points);
        if (!Number.isInteger(numPts) || numPts <= 0 || numPts > 100000) {
          errors.push(`Invalid points at index ${i}. Points must be a positive integer (max 100000).`);
        }
      }
      if (item.problemOrder !== undefined || item.order !== undefined) {
        const numOrd = Number(item.problemOrder || item.order);
        if (!Number.isInteger(numOrd) || numOrd <= 0) {
          errors.push(`Invalid problemOrder at index ${i}. Problem order must be a positive integer.`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed for bulk adding problems to contest',
      errors,
    });
  }

  next();
};

/**
 * Validate problem removal from contest
 */
const validateRemoveProblemFromContest = (req, res, next) => {
  const rawContestId = req.params.contestId || req.params.id;
  const rawProblemId = req.params.problemId;
  const errors = [];

  const numContestId = Number(rawContestId);
  if (!rawContestId || !Number.isInteger(numContestId) || numContestId <= 0) {
    errors.push('A valid positive integer contest ID is required.');
  }

  const numProblemId = Number(rawProblemId);
  if (!rawProblemId || !Number.isInteger(numProblemId) || numProblemId <= 0) {
    errors.push('A valid positive integer problemId is required.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed for removing problem from contest',
      errors,
    });
  }

  next();
};

/**
 * Validate contest problem ordering payload
 */
const validateReorderContestProblems = (req, res, next) => {
  const rawContestId = req.params.contestId || req.params.id;
  const errors = [];

  const numContestId = Number(rawContestId);
  if (!rawContestId || !Number.isInteger(numContestId) || numContestId <= 0) {
    errors.push('A valid positive integer contest ID is required.');
  }

  const body = req.body || {};
  const candidateList = body.problemIds || body.orderedProblemIds || body.problems || body.order || (Array.isArray(body) ? body : null);

  if (!candidateList || !Array.isArray(candidateList) || candidateList.length === 0) {
    errors.push('A non-empty array of problem IDs or ordering objects is required.');
  } else if (candidateList.length > 100) {
    errors.push('Problem ordering array exceeds maximum allowed limit of 100 items.');
  } else {
    const seen = new Set();
    for (const item of candidateList) {
      const rawId = typeof item === 'object' && item !== null ? (item.problemId || item.id) : item;
      const idNum = Number(rawId);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        errors.push(`Invalid problem ID: ${rawId}. Problem ID must be a positive integer.`);
        break;
      }
      if (seen.has(idNum)) {
        errors.push(`Duplicate problem ID: ${idNum}. Each problem ID must appear exactly once.`);
        break;
      }
      seen.add(idNum);
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed for contest problem ordering',
      errors,
    });
  }

  next();
};

/**
 * Validate bulk participant addition to contest
 */
const validateBulkAddParticipants = (req, res, next) => {
  const rawContestId = req.params.contestId || req.params.id;
  const errors = [];

  const numContestId = Number(rawContestId);
  if (!rawContestId || !Number.isInteger(numContestId) || numContestId <= 0) {
    errors.push('A valid positive integer contest ID is required.');
  }

  const body = req.body || {};
  let candidateList = body.userIds || body.participants || body.studentIds || (Array.isArray(body) ? body : null);

  if (!candidateList || !Array.isArray(candidateList) || candidateList.length === 0) {
    errors.push('A non-empty array of user IDs or participant objects is required.');
  } else if (candidateList.length > 100) {
    errors.push('Participants array exceeds maximum allowed limit of 100 items.');
  } else {
    for (let i = 0; i < candidateList.length; i++) {
      const item = candidateList[i];
      const rawId = typeof item === 'object' && item !== null ? (item.userId || item.id || item.studentId) : item;
      const idNum = Number(rawId);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        errors.push(`Invalid participant ID at index ${i}: ${rawId}. ID must be a positive integer.`);
        break;
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed for bulk adding participants to contest',
      errors,
    });
  }

  next();
};

/**
 * Validate bulk participant removal from contest
 */
const validateBulkRemoveParticipants = (req, res, next) => {
  const rawContestId = req.params.contestId || req.params.id;
  const errors = [];

  const numContestId = Number(rawContestId);
  if (!rawContestId || !Number.isInteger(numContestId) || numContestId <= 0) {
    errors.push('A valid positive integer contest ID is required.');
  }

  const body = req.body || {};
  let candidateList = body.userIds || body.participants || body.participantIds || (Array.isArray(body) ? body : null);

  if (!candidateList || !Array.isArray(candidateList) || candidateList.length === 0) {
    errors.push('A non-empty array of participant user IDs is required.');
  } else if (candidateList.length > 100) {
    errors.push('Participant IDs array exceeds maximum allowed limit of 100 items.');
  } else {
    for (let i = 0; i < candidateList.length; i++) {
      const item = candidateList[i];
      const rawId = typeof item === 'object' && item !== null ? (item.userId || item.id) : item;
      const idNum = Number(rawId);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        errors.push(`Invalid participant ID at index ${i}: ${rawId}. ID must be a positive integer.`);
        break;
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed for bulk removing participants from contest',
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
  validateBulkAddContestProblems,
  validateRemoveProblemFromContest,
  validateReorderContestProblems,
  validateBulkAddParticipants,
  validateBulkRemoveParticipants,
};
