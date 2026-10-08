const db = require('../config/db');
const ContestModel = require('../models/contestModel');
const RatingModel = require('../models/ratingModel');
const RATING_CONFIG = require('../config/ratingConfig');
const AuditLogger = require('./auditLogger');
const { getContestRuntimeState, canManageResource } = require('./contestService');

/**
 * Competitive Rating Service - Multi-participant Elo rating calculation, rank determination, and transactional finalization
 */
class RatingService {
  /**
   * Deterministic Pairwise Multi-Participant Elo Rating Algorithm
   * 
   * @param {Array<Object>} participants - Array of participant standings:
   *   { userId, username, currentRating, highestRating, ratingStatus, ratedContestCount, rank, totalScore, totalTimeMs }
   * @returns {Array<Object>} List of calculated rating updates
   */
  static calculateRatingChanges(participants) {
    if (!Array.isArray(participants) || participants.length === 0) return [];

    // 1. Sanitize, type-coerce, and validate participant records
    const seenUserIds = new Set();
    const sanitized = [];

    for (const raw of participants) {
      if (!raw || typeof raw !== 'object') continue;

      const rawId = raw.userId !== undefined ? raw.userId : raw.id;
      const parsedId = Number(rawId);
      if (!Number.isInteger(parsedId) || parsedId <= 0) continue;

      // Deduplicate by userId
      if (seenUserIds.has(parsedId)) continue;
      seenUserIds.add(parsedId);

      // Sanitize numerical ratings to prevent string concatenation or NaN poisoning
      const rawCurrent = Number(raw.currentRating);
      const currentRating = Number.isFinite(rawCurrent)
        ? Math.max(RATING_CONFIG.MIN_RATING, Math.round(rawCurrent))
        : RATING_CONFIG.INITIAL_RATING;

      const rawHighest = Number(raw.highestRating);
      const highestRating = Number.isFinite(rawHighest)
        ? Math.max(currentRating, Math.round(rawHighest))
        : Math.max(currentRating, RATING_CONFIG.INITIAL_RATING);

      const rawCount = Number(raw.ratedContestCount);
      const ratedContestCount =
        Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : 0;

      const rawRank = Number(raw.rank);
      const rank = Number.isFinite(rawRank) && rawRank > 0 ? Math.floor(rawRank) : null;

      const totalScore = Number.isFinite(Number(raw.totalScore)) ? Number(raw.totalScore) : 0;
      const totalPenaltyMinutes = Number.isFinite(Number(raw.totalPenaltyMinutes))
        ? Number(raw.totalPenaltyMinutes)
        : 0;
      const totalTimeMs = Number.isFinite(Number(raw.totalTimeMs)) ? Number(raw.totalTimeMs) : 0;

      let lastAcceptedAtMs = null;
      if (Number.isFinite(Number(raw.lastAcceptedAtMs))) {
        lastAcceptedAtMs = Number(raw.lastAcceptedAtMs);
      } else if (raw.lastAcceptedAt) {
        const parsed = new Date(raw.lastAcceptedAt).getTime();
        if (Number.isFinite(parsed)) lastAcceptedAtMs = parsed;
      }

      sanitized.push({
        userId: parsedId,
        username: raw.username || `user_${parsedId}`,
        currentRating,
        highestRating,
        ratedContestCount,
        ratingStatus:
          raw.ratingStatus === 'rated' ||
          ratedContestCount >= RATING_CONFIG.PROVISIONAL_CONTEST_THRESHOLD
            ? 'rated'
            : 'provisional',
        rank,
        totalScore,
        totalPenaltyMinutes,
        totalTimeMs,
        lastAcceptedAtMs,
      });
    }

    const N = sanitized.length;
    if (N === 0) return [];

    // 2. Rank Assignment Fallback: If any participant has missing rank, compute standard competition ranks
    const anyMissingRank = sanitized.some((p) => p.rank === null);
    if (anyMissingRank) {
      sanitized.sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        if (a.totalPenaltyMinutes !== b.totalPenaltyMinutes)
          return a.totalPenaltyMinutes - b.totalPenaltyMinutes;
        if (a.lastAcceptedAtMs && b.lastAcceptedAtMs) {
          const timeDiff = a.lastAcceptedAtMs - b.lastAcceptedAtMs;
          if (timeDiff !== 0) return timeDiff;
        } else if (a.lastAcceptedAtMs && !b.lastAcceptedAtMs) {
          return -1;
        } else if (!a.lastAcceptedAtMs && b.lastAcceptedAtMs) {
          return 1;
        }
        if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
        return a.userId - b.userId;
      });

      for (let i = 0; i < N; i++) {
        if (i > 0) {
          const prev = sanitized[i - 1];
          const curr = sanitized[i];
          if (
            curr.totalScore === prev.totalScore &&
            curr.totalPenaltyMinutes === prev.totalPenaltyMinutes &&
            curr.lastAcceptedAtMs === prev.lastAcceptedAtMs &&
            curr.totalTimeMs === prev.totalTimeMs
          ) {
            curr.rank = prev.rank;
          } else {
            curr.rank = i + 1;
          }
        } else {
          sanitized[0].rank = 1;
        }
      }
    } else {
      // Deterministically sort by (rank ASC, userId ASC) for reproducible pairwise floating-point summation
      sanitized.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.userId - b.userId;
      });
    }

    // 3. Single participant edge case: no rating delta possible
    if (N === 1) {
      const p = sanitized[0];
      const newRatedCount = p.ratedContestCount + 1;
      const newStatus =
        newRatedCount >= RATING_CONFIG.PROVISIONAL_CONTEST_THRESHOLD ? 'rated' : 'provisional';
      return [
        {
          userId: p.userId,
          username: p.username,
          previousRating: p.currentRating,
          ratingChange: 0,
          newRating: p.currentRating,
          newHighestRating: p.highestRating,
          newRatingStatus: newStatus,
          newRatedContestCount: newRatedCount,
          rank: p.rank || 1,
          participantCount: 1,
          performanceRating: p.currentRating,
        },
      ];
    }

    const results = [];

    // 4. Pairwise multi-participant Elo calculation
    for (let i = 0; i < N; i++) {
      const p = sanitized[i];
      let actualScoreSum = 0;
      let expectedScoreSum = 0;

      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const opponent = sanitized[j];

        // 1. Expected score against opponent j: E_ij = 1 / (1 + 10^((R_j - R_i) / 400))
        const exponent = (opponent.currentRating - p.currentRating) / 400.0;
        const expectedScore = 1.0 / (1.0 + Math.pow(10.0, exponent));
        expectedScoreSum += expectedScore;

        // 2. Actual outcome based on rank: 1.0 (win), 0.5 (tie), 0.0 (loss)
        if (p.rank < opponent.rank) {
          actualScoreSum += 1.0;
        } else if (p.rank === opponent.rank) {
          actualScoreSum += 0.5;
        } else {
          actualScoreSum += 0.0;
        }
      }

      // 3. Determine K-Factor: Provisional vs Rated
      const isProvisional =
        p.ratedContestCount < RATING_CONFIG.PROVISIONAL_CONTEST_THRESHOLD;
      const kFactor = isProvisional
        ? RATING_CONFIG.PROVISIONAL_K_FACTOR
        : RATING_CONFIG.RATED_K_FACTOR;

      // 4. Normalized Delta: Delta_R = round( (K / (N - 1)) * (Actual - Expected) )
      const rawDelta = (kFactor / (N - 1)) * (actualScoreSum - expectedScoreSum);
      const ratingChange = Math.round(rawDelta);

      // 5. Calculate new rating and highest rating with floor enforcement
      const newRating = Math.max(RATING_CONFIG.MIN_RATING, p.currentRating + ratingChange);
      const effectiveRatingChange = newRating - p.currentRating;
      const newHighestRating = Math.max(p.highestRating, newRating);
      const newRatedCount = p.ratedContestCount + 1;
      const newStatus =
        newRatedCount >= RATING_CONFIG.PROVISIONAL_CONTEST_THRESHOLD ? 'rated' : 'provisional';

      // Performance rating approximation
      const performanceRating = Math.round(
        p.currentRating + ((actualScoreSum - (N - 1) / 2) / (N - 1)) * 400
      );

      results.push({
        userId: p.userId,
        username: p.username,
        previousRating: p.currentRating,
        ratingChange: effectiveRatingChange,
        newRating,
        newHighestRating,
        newRatingStatus: newStatus,
        newRatedContestCount: newRatedCount,
        rank: p.rank,
        participantCount: N,
        performanceRating,
      });
    }

    return results;
  }

  /**
   * Calculate authoritative final contest standings for a contest across all participants
   */
  static async computeContestStandings(contestId, clientOrDb = null) {
    const StandingsService = require('./standingsService');
    const result = await StandingsService.computeContestStandings({
      contestId,
      isExport: true,
      limit: 'all',
      freezeOverride: true,
      clientOrDb,
    });
    return result._allParticipants || result.standings || [];
  }

  /**
   * Finalize ratings for a completed contest inside an ACID transaction (Idempotent)
   *
   * Result Immutability Contract:
   *   Once is_rating_finalized = true, the final_results_snapshot column is the authoritative,
   *   sealed record of official standings and rating changes. The server enforces this lock
   *   through the idempotency check inside a FOR UPDATE row lock. No client-supplied flag
   *   (isFinal, isLocked, isPublished, etc.) can bypass this server-side authority.
   *
   * @param {number|string} contestId
   * @param {Object} operatorUser - { id, role }
   * @param {Object} options - { force: boolean }
   * @returns {Promise<Object>} Finalization results
   */
  static async finalizeContestRatings(contestId, operatorUser = null, options = {}, req = null) {
    const force = Boolean(options && options.force);
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Fetch and row-lock the contest to prevent concurrent duplicate finalization.
      // The FOR UPDATE lock serializes concurrent finalization requests at the database level,
      // guaranteeing that only one transaction can proceed through the finalization path at a time.
      const contestRes = await client.query(
        `SELECT * FROM contests WHERE id = $1 FOR UPDATE;`,
        [contestId]
      );

      if (!contestRes.rows[0]) {
        await client.query('ROLLBACK');
        const err = new Error(`Contest with ID ${contestId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const contest = contestRes.rows[0];

      // 2. Caller Authorization Verification under DB lock
      if (operatorUser && !canManageResource(operatorUser, contest)) {
        await AuditLogger.logAction({
          actor: operatorUser,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contest.id,
          outcome: 'denied',
          metadata: { attemptedAction: 'CONTEST_FINALIZATION', reason: 'UNAUTHORIZED_OPERATOR' },
          req,
        });
        await client.query('ROLLBACK');
        const err = new Error('Forbidden: You do not have permission to finalize contest ratings');
        err.statusCode = 403;
        throw err;
      }

      // 3. Verify contest is published (not draft/archived)
      if (contest.status !== 'published') {
        if (operatorUser) {
          await AuditLogger.logAction({
            actor: operatorUser,
            action: 'PRIVILEGED_ACTION_DENIED',
            resourceType: 'contest',
            resourceId: contest.id,
            outcome: 'denied',
            metadata: { attemptedAction: 'CONTEST_FINALIZATION', reason: 'CONTEST_NOT_PUBLISHED', status: contest.status },
            req,
          });
        }
        await client.query('ROLLBACK');
        const err = new Error('Cannot finalize ratings: Contest is in draft status');
        err.statusCode = 400;
        throw err;
      }

      // 4. IDEMPOTENCY CHECK: If already finalized, return existing data without recalculating.
      //
      // CRITICAL ORDER: This check MUST fire before the is_rated gate and before all other
      // validation checks. Reasons:
      //   a) Both rated AND unrated finalized contests must return alreadyFinalized idempotently.
      //   b) A finalized contest may no longer satisfy timing conditions (e.g., status changed
      //      after finalization), so re-validating would incorrectly block the idempotent return.
      //   c) The FOR UPDATE row lock (step 1) guarantees this check + the atomic return below
      //      cannot race with another concurrent finalization request.
      //
      // RESULT IMMUTABILITY: is_rating_finalized=true is the authoritative server-side lock.
      // The final_results_snapshot is sealed at this point. No client-supplied body field
      // (isFinal, isLocked, isPublished, score, rank, etc.) can alter or bypass this lock.
      if (contest.is_rating_finalized) {
        const existingHistory = await client.query(
          `SELECT * FROM rating_history WHERE contest_id = $1 ORDER BY rank ASC;`,
          [contestId]
        );
        if (operatorUser) {
          await AuditLogger.logAction({
            actor: operatorUser,
            action: 'RATINGS_FINALIZED',
            resourceType: 'contest',
            resourceId: contest.id,
            outcome: 'success',
            metadata: {
              participantCount: existingHistory.rowCount,
              isRated: Boolean(contest.is_rated),
              isIdempotentSkip: true,
              attemptType: 'repeated_finalization',
            },
            client,
            req,
          });
        }
        await client.query('COMMIT');
        return {
          alreadyFinalized: true,
          message: 'Ratings and final results have already been finalized and published for this contest.',
          contestId: contest.id,
          finalizedAt: contest.ratings_finalized_at,
          isRated: Boolean(contest.is_rated),
          ratingUpdates: existingHistory.rows,
          finalResultsSnapshot: contest.final_results_snapshot || null,
        };
      }

      // 4. Timing Check (Contest must be ended unless force = true for administrative needs)
      const runtimeState = getContestRuntimeState(contest);
      if (runtimeState !== 'ended' && !force) {
        if (operatorUser) {
          await AuditLogger.logAction({
            actor: operatorUser,
            action: 'PRIVILEGED_ACTION_DENIED',
            resourceType: 'contest',
            resourceId: contest.id,
            outcome: 'denied',
            metadata: { attemptedAction: 'CONTEST_FINALIZATION', reason: 'CONTEST_NOT_ENDED', runtimeState },
            req,
          });
        }
        await client.query('ROLLBACK');
        const err = new Error(`Cannot finalize ratings while contest is '${runtimeState}'. Contest must be ended.`);
        err.statusCode = 400;
        throw err;
      }

      // 5. Pending Submissions Check: Do not finalize if submissions are currently queued or being judged.
      // This prevents final_results_snapshot from being computed before all judge verdicts arrive.
      // Any judge worker completing a verdict after finalization will write to submissions normally,
      // but the official sealed snapshot (final_results_snapshot) remains unchanged.
      const pendingRes = await client.query(
        `SELECT COUNT(*)::int AS count 
         FROM submissions 
         WHERE contest_id = $1 AND is_sample_run = false AND status IN ('queued', 'running');`,
        [contestId]
      );
      const pendingCount = pendingRes.rows[0]?.count || 0;
      if (pendingCount > 0 && !force) {
        if (operatorUser) {
          await AuditLogger.logAction({
            actor: operatorUser,
            action: 'PRIVILEGED_ACTION_DENIED',
            resourceType: 'contest',
            resourceId: contest.id,
            outcome: 'denied',
            metadata: { attemptedAction: 'CONTEST_FINALIZATION', reason: 'PENDING_SUBMISSIONS', pendingCount },
            req,
          });
        }
        await client.query('ROLLBACK');
        const err = new Error(
          `Cannot finalize contest: There are ${pendingCount} submission(s) currently being evaluated by the judge. Please wait for judging to complete before finalizing results.`
        );
        err.statusCode = 409;
        throw err;
      }

      // 6. Compute deterministic standings across all submissions up to contest end
      const standings = await this.computeContestStandings(contestId, client);

      if (standings.length === 0) {
        const snapshot = {
          calculatedAt: new Date().toISOString(),
          totalParticipants: 0,
          isRated: Boolean(contest.is_rated),
          topScore: 0,
          podium: [],
          standings: [],
          ratingUpdates: [],
        };

        // Mark as finalized even if 0 participants to close contest lifecycle
        await client.query(
          `UPDATE contests 
           SET is_rating_finalized = true, 
               ratings_finalized_at = CURRENT_TIMESTAMP,
               final_results_snapshot = $2
           WHERE id = $1;`,
          [contestId, JSON.stringify(snapshot)]
        );

        if (operatorUser) {
          await AuditLogger.logAction({
            actor: operatorUser,
            action: 'RATINGS_FINALIZED',
            resourceType: 'contest',
            resourceId: contest.id,
            outcome: 'success',
            metadata: { participantCount: 0, isRated: Boolean(contest.is_rated), isIdempotentSkip: false },
            client,
            req,
          });
        }

        await client.query('COMMIT');
        return {
          message: 'Contest finalized with 0 participants. No rating updates needed.',
          contestId: contest.id,
          finalizedAt: new Date().toISOString(),
          isRated: Boolean(contest.is_rated),
          ratingUpdates: [],
          finalResultsSnapshot: snapshot,
        };
      }

      // 7. Unrated Contest Finalization: Record official standings and snapshot without rating changes.
      // NOTE: is_rated is intentionally checked HERE (after idempotency + timing + pending checks)
      // so that unrated contests flow through the same safety gates as rated ones before being sealed.
      if (!contest.is_rated) {
        const snapshot = {
          calculatedAt: new Date().toISOString(),
          totalParticipants: standings.length,
          isRated: false,
          topScore: standings[0]?.totalScore || 0,
          podium: standings.slice(0, 3),
          standings,
          ratingUpdates: [],
        };

        await client.query(
          `UPDATE contests 
           SET is_rating_finalized = true, 
               ratings_finalized_at = CURRENT_TIMESTAMP,
               final_results_snapshot = $2
           WHERE id = $1;`,
          [contestId, JSON.stringify(snapshot)]
        );

        if (operatorUser) {
          await AuditLogger.logAction({
            actor: operatorUser,
            action: 'RATINGS_FINALIZED',
            resourceType: 'contest',
            resourceId: contest.id,
            outcome: 'success',
            metadata: { participantCount: standings.length, isRated: false, isIdempotentSkip: false },
            client,
            req,
          });
        }

        await client.query('COMMIT');
        return {
          message: `Contest final results successfully published for ${standings.length} participants (unrated contest).`,
          contestId: contest.id,
          finalizedAt: new Date().toISOString(),
          isRated: false,
          ratingUpdates: [],
          finalResultsSnapshot: snapshot,
          standings,
        };
      }

      // 8. Calculate pairwise Elo deltas for rated contest
      const ratingUpdates = this.calculateRatingChanges(standings);

      if (options && options.__testSimulateFailureAt === 'rating_history') {
        throw new Error('SIMULATED_FAILURE_RATING_HISTORY');
      }

      // 9. Persist rating history and user updates for each participant
      // Sort deterministically by userId ascending to guarantee uniform lock order and avoid cross-contest deadlocks
      const updatesSortedByUserId = [...ratingUpdates].sort((a, b) => a.userId - b.userId);
      for (const update of updatesSortedByUserId) {
        // Insert rating history entry FIRST
        await RatingModel.createRatingHistoryEntry(client, {
          userId: update.userId,
          contestId: contest.id,
          previousRating: update.previousRating,
          ratingChange: update.ratingChange,
          newRating: update.newRating,
          rank: update.rank,
          participantCount: update.participantCount,
          performanceRating: update.performanceRating,
          ratingStatus: update.newRatingStatus,
        });

        if (options && options.__testSimulateFailureAt === 'user_rating') {
          throw new Error('SIMULATED_FAILURE_USER_RATING');
        }

        // Update user record
        await RatingModel.updateUserRating(client, update.userId, {
          currentRating: update.newRating,
          highestRating: update.newHighestRating,
          ratingStatus: update.newRatingStatus,
          ratedContestCount: update.newRatedContestCount,
        });
      }

      if (options && options.__testSimulateFailureAt === 'snapshot') {
        throw new Error('SIMULATED_FAILURE_SNAPSHOT');
      }

      // 10. Build final results snapshot and mark contest as finalized.
      // Once this UPDATE commits, is_rating_finalized=true seals the result permanently.
      // The final_results_snapshot JSONB column is the official immutable record of:
      //   - final standings (ranks, scores, penalties, solved counts)
      //   - rating updates (previous/new ratings, deltas, performance ratings)
      //   - podium (top 3 participants)
      // Subsequent calls return alreadyFinalized=true from step 4 without re-computing.
      const snapshot = {
        calculatedAt: new Date().toISOString(),
        totalParticipants: standings.length,
        isRated: true,
        topScore: standings[0]?.totalScore || 0,
        podium: standings.slice(0, 3),
        standings,
        ratingUpdates,
      };

      if (options && options.__testSimulateFailureAt === 'contest_update') {
        throw new Error('SIMULATED_FAILURE_CONTEST_UPDATE');
      }

      await client.query(
        `UPDATE contests 
         SET is_rating_finalized = true, 
             ratings_finalized_at = CURRENT_TIMESTAMP,
             final_results_snapshot = $2
         WHERE id = $1;`,
        [contestId, JSON.stringify(snapshot)]
      );

      if (options && options.__testSimulateFailureAt === 'audit_logging') {
        throw new Error('SIMULATED_FAILURE_AUDIT_LOGGING');
      }

      if (operatorUser) {
        await AuditLogger.logAction({
          actor: operatorUser,
          action: 'RATINGS_FINALIZED',
          resourceType: 'contest',
          resourceId: contest.id,
          outcome: 'success',
          metadata: { participantCount: ratingUpdates.length, isRated: true, isIdempotentSkip: false },
          client,
          req,
        });
      }

      await client.query('COMMIT');

      return {
        message: `Successfully calculated and applied rating updates for ${ratingUpdates.length} participants`,
        contestId: contest.id,
        finalizedAt: new Date().toISOString(),
        isRated: true,
        ratingUpdates,
        finalResultsSnapshot: snapshot,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = RatingService;
