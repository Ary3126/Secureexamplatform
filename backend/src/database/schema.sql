-- ========================================================
-- Database Schema for Secure Competitive Programming & Examination Platform
-- ========================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'professor', 'contest_admin', 'super_admin')),
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    institution VARCHAR(150) DEFAULT '',
    current_rating INTEGER NOT NULL DEFAULT 1200,
    highest_rating INTEGER NOT NULL DEFAULT 1200,
    rating_status VARCHAR(20) NOT NULL DEFAULT 'provisional' CHECK (rating_status IN ('provisional', 'rated')),
    rated_contest_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_test_data BOOLEAN NOT NULL DEFAULT false,
    test_run_id VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_institution ON users(institution);
CREATE INDEX IF NOT EXISTS idx_users_rating_status ON users(rating_status);
CREATE INDEX IF NOT EXISTS idx_users_current_rating ON users(current_rating DESC);
CREATE INDEX IF NOT EXISTS idx_users_rating_desc_id_asc ON users(current_rating DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_users_test_data ON users(is_test_data, test_run_id);

-- 2. CONTESTS TABLE (Phase 3 & 5.4)
CREATE TABLE IF NOT EXISTS contests (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    is_rated BOOLEAN NOT NULL DEFAULT true,
    is_rating_finalized BOOLEAN NOT NULL DEFAULT false,
    ratings_finalized_at TIMESTAMP WITH TIME ZONE,
    leaderboard_freeze_enabled BOOLEAN NOT NULL DEFAULT false,
    leaderboard_freeze_minutes INTEGER NOT NULL DEFAULT 60,
    final_results_snapshot JSONB DEFAULT NULL,
    is_test_data BOOLEAN NOT NULL DEFAULT false,
    test_run_id VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_contest_times CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_contests_created_by ON contests(created_by);
CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status);
CREATE INDEX IF NOT EXISTS idx_contests_times ON contests(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_contests_test_data ON contests(is_test_data, test_run_id);
CREATE INDEX IF NOT EXISTS idx_submissions_contest_user_status ON submissions(contest_id, user_id, status, is_sample_run);
CREATE INDEX IF NOT EXISTS idx_submissions_contest_standings ON submissions(contest_id, is_sample_run, created_at ASC);

-- 3. PROBLEMS TABLE (Phase 3 & 4A Extra & 5.9.5 Versioning)
CREATE TABLE IF NOT EXISTS problems (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    coding_mode VARCHAR(30) NOT NULL DEFAULT 'full_program' CHECK (coding_mode IN ('full_program', 'function')),
    starter_templates JSONB DEFAULT '{}'::jsonb,
    harness_templates JSONB DEFAULT '{}'::jsonb,
    function_config JSONB DEFAULT '{}'::jsonb,
    allowed_languages JSONB DEFAULT '["python", "cpp", "java", "javascript", "c"]'::jsonb,
    access_scope VARCHAR(30) NOT NULL DEFAULT 'contest_private' CHECK (access_scope IN ('public', 'contest_private', 'class', 'institution')),
    version INTEGER NOT NULL DEFAULT 1,
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMP WITH TIME ZONE,
    review_status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'review_requested', 'in_review', 'changes_requested', 'rejected', 'approved', 'published', 'archived', 'withdrawn')),
    approved_version INTEGER,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    scheduled_publish_at TIMESTAMP WITH TIME ZONE,
    scheduled_publish_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_test_data BOOLEAN NOT NULL DEFAULT false,
    test_run_id VARCHAR(100) DEFAULT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_problems_created_by ON problems(created_by);
CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_problems_coding_mode ON problems(coding_mode);
CREATE INDEX IF NOT EXISTS idx_problems_access_scope ON problems(access_scope);
CREATE INDEX IF NOT EXISTS idx_problems_version ON problems(version);
CREATE INDEX IF NOT EXISTS idx_problems_is_published ON problems(is_published);
CREATE INDEX IF NOT EXISTS idx_problems_review_status ON problems(review_status);
CREATE INDEX IF NOT EXISTS idx_problems_scheduled_publish ON problems(scheduled_publish_at) WHERE scheduled_publish_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_problems_test_data ON problems(is_test_data, test_run_id);

-- 3b. PROBLEM_VERSIONS TABLE (Phase 5.9.5 Problem Versioning & Historical Judging Integrity & 5.9.8 Lifecycle)
CREATE TABLE IF NOT EXISTS problem_versions (
    id SERIAL PRIMARY KEY,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    coding_mode VARCHAR(30) NOT NULL DEFAULT 'full_program' CHECK (coding_mode IN ('full_program', 'function')),
    starter_templates JSONB DEFAULT '{}'::jsonb,
    harness_templates JSONB DEFAULT '{}'::jsonb,
    function_config JSONB DEFAULT '{}'::jsonb,
    allowed_languages JSONB DEFAULT '["python", "cpp", "java", "javascript", "c"]'::jsonb,
    access_scope VARCHAR(30) NOT NULL DEFAULT 'contest_private',
    test_cases_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation_config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    change_summary TEXT,
    source_action VARCHAR(50) DEFAULT 'published',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_problem_versions_prob_ver UNIQUE (problem_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_problem_versions_problem_id ON problem_versions(problem_id);
CREATE INDEX IF NOT EXISTS idx_problem_versions_lookup ON problem_versions(problem_id, version_number);

-- 3c. PROBLEM_REVIEWS TABLE (Phase 5.9.6 Secure Problem Review & Approval Governance)
CREATE TABLE IF NOT EXISTS problem_reviews (
    id SERIAL PRIMARY KEY,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    problem_version INTEGER NOT NULL,
    submitted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'changes_requested', 'rejected', 'approved', 'revoked')),
    decision_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_problem_reviews_problem ON problem_reviews(problem_id, problem_version);
CREATE INDEX IF NOT EXISTS idx_problem_reviews_reviewer ON problem_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_problem_reviews_status ON problem_reviews(status);
CREATE INDEX IF NOT EXISTS idx_problem_reviews_submitted_by ON problem_reviews(submitted_by);
CREATE INDEX IF NOT EXISTS idx_problem_reviews_created_at ON problem_reviews(created_at DESC);

-- 3d. PROBLEM_REVIEW_COMMENTS TABLE (Phase 5.9.6 Persistent Review Dialogue & Feedback)
CREATE TABLE IF NOT EXISTS problem_review_comments (
    id SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES problem_reviews(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_type VARCHAR(30) NOT NULL DEFAULT 'general' CHECK (comment_type IN ('general', 'change_request', 'rejection_reason', 'approval_note', 'author_response')),
    comment TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_comments_review_id ON problem_review_comments(review_id);
CREATE INDEX IF NOT EXISTS idx_review_comments_author_id ON problem_review_comments(author_id);
CREATE INDEX IF NOT EXISTS idx_review_comments_created_at ON problem_review_comments(created_at ASC);

-- 3e. PROBLEM_QUALITY_SNAPSHOTS TABLE (Phase 5.9.7 Problem Quality, Editorial Intelligence & Review Analytics)
CREATE TABLE IF NOT EXISTS problem_quality_snapshots (
    id SERIAL PRIMARY KEY,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    problem_version INTEGER NOT NULL,
    quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
    quality_level VARCHAR(30) NOT NULL,
    breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_problem_quality_prob_ver UNIQUE (problem_id, problem_version)
);

CREATE INDEX IF NOT EXISTS idx_problem_quality_problem ON problem_quality_snapshots(problem_id);
CREATE INDEX IF NOT EXISTS idx_problem_quality_lookup ON problem_quality_snapshots(problem_id, problem_version);

-- 4. CONTEST_PROBLEMS RELATIONSHIP TABLE (Phase 3)
CREATE TABLE IF NOT EXISTS contest_problems (
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    problem_order INTEGER NOT NULL DEFAULT 1 CHECK (problem_order > 0),
    points INTEGER NOT NULL DEFAULT 100 CHECK (points > 0),
    PRIMARY KEY (contest_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_problems_contest ON contest_problems(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_problems_problem ON contest_problems(problem_id);

-- 5. CONTEST_PARTICIPANTS TABLE (Phase 3)
CREATE TABLE IF NOT EXISTS contest_participants (
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_participants_contest ON contest_participants(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_participants_user ON contest_participants(user_id);

-- 6. TEST_CASES TABLE (Phase 4A)
CREATE TABLE IF NOT EXISTS test_cases (
    id SERIAL PRIMARY KEY,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    input_data TEXT NOT NULL,
    expected_output TEXT NOT NULL,
    is_sample BOOLEAN NOT NULL DEFAULT false,
    order_index INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_test_cases_problem ON test_cases(problem_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_is_sample ON test_cases(is_sample);

-- 7. SUBMISSIONS TABLE (Phase 4A & 4B)
CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contest_id INTEGER REFERENCES contests(id) ON DELETE RESTRICT,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE RESTRICT,
    language VARCHAR(20) NOT NULL,
    coding_mode VARCHAR(30) NOT NULL DEFAULT 'full_program' CHECK (coding_mode IN ('full_program', 'function')),
    source_code TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'compilation_error', 'runtime_error', 'system_error')),
    score INTEGER DEFAULT 0,
    execution_time INTEGER DEFAULT 0,
    memory_used INTEGER DEFAULT 0,
    error_message TEXT,
    is_sample_run BOOLEAN NOT NULL DEFAULT false,
    test_cases_passed INTEGER DEFAULT 0,
    test_cases_total INTEGER DEFAULT 0,
    validation_summary JSONB,
    problem_version INTEGER NOT NULL DEFAULT 1,
    is_test_data BOOLEAN NOT NULL DEFAULT false,
    test_run_id VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_contest_id ON submissions(contest_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem_id ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem_version ON submissions(problem_id, problem_version);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_is_sample_run ON submissions(is_sample_run);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_test_data ON submissions(is_test_data, test_run_id);

-- Phase 5.8.6: Targeted partial covering index for performance statistics, percentiles, and distribution histograms
CREATE INDEX IF NOT EXISTS idx_submissions_perf_analytics 
ON submissions(problem_id, LOWER(language), contest_id) 
INCLUDE (execution_time, memory_used) 
WHERE status = 'accepted' AND is_sample_run = false;

-- Phase 5.8.6: Candidate lookup index for user problem submission history and side-by-side comparison
CREATE INDEX IF NOT EXISTS idx_submissions_user_problem_recent 
ON submissions(user_id, problem_id, created_at DESC) 
WHERE is_sample_run = false;

-- 8. PROBLEM_VALIDATION_CONFIGS TABLE (Phase 4B.1)
CREATE TABLE IF NOT EXISTS problem_validation_configs (
    problem_id INTEGER PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
    validation_enabled BOOLEAN NOT NULL DEFAULT true,
    generator_type VARCHAR(50) NOT NULL DEFAULT 'range_generator',
    generator_params JSONB NOT NULL DEFAULT '{"min": 1, "max": 1000}'::jsonb,
    random_test_count INTEGER NOT NULL DEFAULT 10 CHECK (random_test_count >= 0 AND random_test_count <= 50),
    oracle_code TEXT,
    oracle_language VARCHAR(20) DEFAULT 'javascript',
    time_limit_ms INTEGER NOT NULL DEFAULT 2000 CHECK (time_limit_ms >= 500 AND time_limit_ms <= 10000),
    memory_limit_mb INTEGER NOT NULL DEFAULT 128 CHECK (memory_limit_mb >= 32 AND memory_limit_mb <= 512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pvc_validation_enabled ON problem_validation_configs(validation_enabled);

-- 9. SUBMISSION_VALIDATION_RUNS TABLE (Phase 4B.5)
CREATE TABLE IF NOT EXISTS submission_validation_runs (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    final_status VARCHAR(50) NOT NULL,
    standard_passed INTEGER DEFAULT 0,
    standard_total INTEGER DEFAULT 0,
    random_passed INTEGER DEFAULT 0,
    random_total INTEGER DEFAULT 0,
    edge_passed INTEGER DEFAULT 0,
    edge_total INTEGER DEFAULT 0,
    boundary_passed INTEGER DEFAULT 0,
    boundary_total INTEGER DEFAULT 0,
    suspicion_score INTEGER DEFAULT 0,
    suspicion_level VARCHAR(20) DEFAULT 'LOW',
    is_flagged BOOLEAN DEFAULT false,
    failure_stage VARCHAR(50),
    failure_reason TEXT,
    execution_time_ms INTEGER DEFAULT 0,
    memory_used_kb INTEGER DEFAULT 0,
    stage_durations JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_svr_submission_id ON submission_validation_runs(submission_id);
CREATE INDEX IF NOT EXISTS idx_svr_problem_id ON submission_validation_runs(problem_id);
CREATE INDEX IF NOT EXISTS idx_svr_final_status ON submission_validation_runs(final_status);

-- 10. SAVED_PROBLEMS TABLE (Phase 5.2)
CREATE TABLE IF NOT EXISTS saved_problems (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_problems_user_id ON saved_problems(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_problems_problem_id ON saved_problems(problem_id);

-- 11. RATING_HISTORY TABLE (Phase 5.4)
CREATE TABLE IF NOT EXISTS rating_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    previous_rating INTEGER NOT NULL,
    rating_change INTEGER NOT NULL,
    new_rating INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    participant_count INTEGER NOT NULL,
    performance_rating INTEGER NOT NULL DEFAULT 1200,
    rating_status VARCHAR(20) NOT NULL DEFAULT 'provisional',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_rating_history_user_contest UNIQUE (user_id, contest_id)
);

CREATE INDEX IF NOT EXISTS idx_rating_history_user_id ON rating_history(user_id);
CREATE INDEX IF NOT EXISTS idx_rating_history_contest_id ON rating_history(contest_id);
CREATE INDEX IF NOT EXISTS idx_rating_history_created_at ON rating_history(created_at);

-- 12. LEADERBOARD_SNAPSHOTS TABLE (Phase 5.6)
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    scope VARCHAR(30) NOT NULL DEFAULT 'global',
    institution VARCHAR(150) DEFAULT '',
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    highest_rating INTEGER NOT NULL,
    rating_status VARCHAR(20) NOT NULL,
    rated_contest_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_leaderboard_snapshot_scope_date_user UNIQUE (scope, institution, snapshot_date, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lb_snapshots_scope_date ON leaderboard_snapshots(scope, institution, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_user ON leaderboard_snapshots(user_id, snapshot_date);

-- 13. TOPICS TABLE (Phase 5.7.1)
CREATE TABLE IF NOT EXISTS topics (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) DEFAULT 'Algorithms',
    description TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topics_key ON topics(LOWER(key));
CREATE INDEX IF NOT EXISTS idx_topics_category ON topics(category);

-- 14. PROBLEM_TOPICS TABLE (Phase 5.7.1)
CREATE TABLE IF NOT EXISTS problem_topics (
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (problem_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_problem_topics_problem_id ON problem_topics(problem_id);
CREATE INDEX IF NOT EXISTS idx_problem_topics_topic_id ON problem_topics(topic_id);

-- 15. USER_SKILLS TABLE (Phase 5.7.1)
CREATE TABLE IF NOT EXISTS user_skills (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    score NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    level VARCHAR(30) NOT NULL DEFAULT 'BEGINNER' CHECK (level IN ('BEGINNER', 'DEVELOPING', 'PROFICIENT', 'ADVANCED', 'EXPERT')),
    confidence NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    classification VARCHAR(30) NOT NULL DEFAULT 'UNASSESSED' CHECK (classification IN ('STRENGTH', 'NEEDS_PRACTICE', 'DEVELOPING', 'STABLE', 'UNASSESSED')),
    attempted_count INTEGER NOT NULL DEFAULT 0,
    solved_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    last_solved_at TIMESTAMP WITH TIME ZONE,
    calculation_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_skills_user_topic UNIQUE (user_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user_id ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_topic_id ON user_skills(topic_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_level ON user_skills(level);
CREATE INDEX IF NOT EXISTS idx_user_skills_classification ON user_skills(classification);

-- 16. USER_SKILL_HISTORY TABLE (Phase 5.7.4)
CREATE TABLE IF NOT EXISTS user_skill_history (
    id SERIAL PRIMARY KEY,
    user_skill_id INTEGER NOT NULL REFERENCES user_skills(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    score NUMERIC(6, 2) NOT NULL,
    level VARCHAR(30) NOT NULL,
    confidence NUMERIC(6, 2) NOT NULL,
    classification VARCHAR(30) DEFAULT 'UNASSESSED',
    attempted_count INTEGER NOT NULL,
    solved_count INTEGER NOT NULL,
    distinct_problems_attempted INTEGER NOT NULL DEFAULT 0,
    distinct_problems_solved INTEGER NOT NULL DEFAULT 0,
    calculation_version INTEGER NOT NULL,
    trigger_submission_id INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_skill_history_user_topic_date ON user_skill_history(user_id, topic_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_skill_history_user_skill_id ON user_skill_history(user_skill_id);
CREATE INDEX IF NOT EXISTS idx_user_skill_history_recorded_at ON user_skill_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_skill_history_lookup ON user_skill_history(user_id, topic_id, recorded_at DESC, id DESC);

-- 17. AUDIT_LOGS TABLE (Phase 5.9.2.3 Persistent Audit Logging System)
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL DEFAULT 'system',
    resource_id INTEGER,
    outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
    metadata JSONB NOT NULL DEFAULT '{}',
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON audit_logs(outcome);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);