/**
 * Request Validation Middleware for Authentication and User Profile
 */

const validateRegister = (req, res, next) => {
  const { username, email, password, fullName } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: username is required and cannot be empty.',
    });
  }

  if (username.trim().length < 3 || username.trim().length > 50) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: username must be between 3 and 50 characters.',
    });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: username can only contain alphanumeric characters, underscores, and hyphens.',
    });
  }

  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: email is required.',
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: email format is invalid.',
    });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: password is required.',
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: password must be at least 8 characters long.',
    });
  }

  if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: fullName is required and cannot be empty.',
    });
  }

  delete req.body.role;
  delete req.body.id;

  next();
};

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: email is required.',
    });
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: password is required.',
    });
  }

  next();
};

const validateUpdateProfile = (req, res, next) => {
  const { fullName, username, bio, avatarUrl, institution } = req.body;

  if (fullName === undefined && username === undefined && bio === undefined && avatarUrl === undefined && institution === undefined) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: At least one profile field (fullName, username, bio, avatarUrl, institution) must be provided for update.',
    });
  }

  if (fullName !== undefined) {
    if (typeof fullName !== 'string' || fullName.trim().length === 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: fullName cannot be empty.',
      });
    }
    if (fullName.trim().length > 100) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: fullName cannot exceed 100 characters.',
      });
    }
  }

  if (username !== undefined) {
    if (typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: username cannot be empty.',
      });
    }
    if (username.trim().length < 3 || username.trim().length > 50) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: username must be between 3 and 50 characters.',
      });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: username can only contain alphanumeric characters, underscores, and hyphens.',
      });
    }
  }

  if (bio !== undefined && typeof bio === 'string' && bio.length > 500) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: bio cannot exceed 500 characters.',
    });
  }

  if (institution !== undefined && typeof institution === 'string' && institution.length > 150) {
    return res.status(400).json({
      status: 'error',
      statusCode: 400,
      message: 'Validation failed: institution cannot exceed 150 characters.',
    });
  }

  // Anti-tamper protection: strictly strip protected fields from request payload
  delete req.body.role;
  delete req.body.id;
  delete req.body.email;
  delete req.body.password;
  delete req.body.password_hash;
  delete req.body.currentRating;
  delete req.body.current_rating;
  delete req.body.highestRating;
  delete req.body.highest_rating;
  delete req.body.ratingStatus;
  delete req.body.rating_status;
  delete req.body.ratedContestCount;
  delete req.body.rated_contest_count;
  delete req.body.rank;

  next();
};

module.exports = {
  validateRegister,
  validateLogin,
  validateUpdateProfile,
};