const db = require('../config/db');

/**
 * ProblemLifecycleModel - Database queries & mutations for Problem Lifecycle, Version Diffs, Rollback & Scheduled Publishing
 */
class ProblemLifecycleModel {
  /**
   * Compare two version snapshots of a problem
   */
  static async compareVersions(problemId, v1, v2, client = null) {
    const text = `
      SELECT 
        version_number AS "versionNumber",
        title,
        description,
        difficulty,
        coding_mode AS "codingMode",
        starter_templates AS "starterTemplates",
        harness_templates AS "harnessTemplates",
        access_scope AS "accessScope",
        test_cases_snapshot AS "testCasesSnapshot",
        validation_config_snapshot AS "validationConfigSnapshot",
        change_summary AS "changeSummary",
        source_action AS "sourceAction",
        created_at AS "createdAt"
      FROM problem_versions
      WHERE problem_id = $1 AND version_number IN ($2, $3)
      ORDER BY version_number ASC;
    `;
    const res = await (client || db).query(text, [problemId, v1, v2]);
    const snap1 = res.rows.find((r) => r.versionNumber === parseInt(v1, 10));
    const snap2 = res.rows.find((r) => r.versionNumber === parseInt(v2, 10));

    if (!snap1 || !snap2) {
      return null;
    }

    const testCases1 = Array.isArray(snap1.testCasesSnapshot) ? snap1.testCasesSnapshot : [];
    const testCases2 = Array.isArray(snap2.testCasesSnapshot) ? snap2.testCasesSnapshot : [];

    const sample1 = testCases1.filter((tc) => !(tc.isHidden ?? tc.is_hidden)).length;
    const hidden1 = testCases1.filter((tc) => Boolean(tc.isHidden ?? tc.is_hidden)).length;
    const sample2 = testCases2.filter((tc) => !(tc.isHidden ?? tc.is_hidden)).length;
    const hidden2 = testCases2.filter((tc) => Boolean(tc.isHidden ?? tc.is_hidden)).length;

    const diff = {
      problemId,
      v1: snap1.versionNumber,
      v2: snap2.versionNumber,
      fields: {
        title: {
          v1: snap1.title,
          v2: snap2.title,
          changed: snap1.title !== snap2.title,
        },
        description: {
          v1: snap1.description,
          v2: snap2.description,
          changed: snap1.description !== snap2.description,
          lengthDiff: (snap2.description || '').length - (snap1.description || '').length,
        },
        difficulty: {
          v1: snap1.difficulty,
          v2: snap2.difficulty,
          changed: snap1.difficulty !== snap2.difficulty,
        },
        codingMode: {
          v1: snap1.codingMode,
          v2: snap2.codingMode,
          changed: snap1.codingMode !== snap2.codingMode,
        },
        accessScope: {
          v1: snap1.accessScope,
          v2: snap2.accessScope,
          changed: snap1.accessScope !== snap2.accessScope,
        },
        testCasesCount: {
          v1: { total: testCases1.length, sample: sample1, hidden: hidden1 },
          v2: { total: testCases2.length, sample: sample2, hidden: hidden2 },
          changed: testCases1.length !== testCases2.length || sample1 !== sample2 || hidden1 !== hidden2,
        },
      },
      hasChanges: false,
    };

    diff.hasChanges = Object.values(diff.fields).some((f) => f.changed);
    return diff;
  }

  /**
   * Schedule problem publication for a future timestamp
   */
  static async schedulePublish(problemId, scheduledAt, actorId, client = null) {
    const text = `
      UPDATE problems
      SET 
        scheduled_publish_at = $2,
        scheduled_publish_by = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING 
        id,
        title,
        version,
        review_status AS "reviewStatus",
        approved_version AS "approvedVersion",
        scheduled_publish_at AS "scheduledPublishAt",
        scheduled_publish_by AS "scheduledPublishBy";
    `;
    const res = await (client || db).query(text, [problemId, scheduledAt, actorId]);
    return res.rows[0];
  }

  /**
   * Cancel scheduled publication
   */
  static async cancelScheduledPublish(problemId, client = null) {
    const text = `
      UPDATE problems
      SET 
        scheduled_publish_at = NULL,
        scheduled_publish_by = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title, version, scheduled_publish_at AS "scheduledPublishAt";
    `;
    const res = await (client || db).query(text, [problemId]);
    return res.rows[0];
  }

  /**
   * Query Dependency & Usage Impact Analysis for a Problem
   */
  static async getDependencyImpact(problemId, client = null) {
    const contestQuery = `
      SELECT 
        c.id,
        c.title,
        c.status,
        c.start_time AS "startTime",
        c.end_time AS "endTime",
        c.created_by AS "createdBy",
        CASE 
          WHEN NOW() < c.start_time THEN 'upcoming'
          WHEN NOW() >= c.start_time AND NOW() <= c.end_time THEN 'running'
          ELSE 'ended'
        END AS "runtimeState"
      FROM contest_problems cp
      JOIN contests c ON cp.contest_id = c.id
      WHERE cp.problem_id = $1
      ORDER BY c.start_time DESC;
    `;
    const contestRes = await (client || db).query(contestQuery, [problemId]);
    const contests = contestRes.rows;

    const subCountQuery = `SELECT COUNT(*)::int AS count FROM submissions WHERE problem_id = $1;`;
    const subRes = await (client || db).query(subCountQuery, [problemId]);
    const totalSubmissions = subRes.rows[0]?.count || 0;

    const savedCountQuery = `SELECT COUNT(*)::int AS count FROM saved_problems WHERE problem_id = $1;`;
    const savedRes = await (client || db).query(savedCountQuery, [problemId]);
    const totalBookmarks = savedRes.rows[0]?.count || 0;

    const runningContests = contests.filter((c) => c.runtimeState === 'running');
    const upcomingContests = contests.filter((c) => c.runtimeState === 'upcoming');
    const activeContestsCount = runningContests.length + upcomingContests.length;

    const blockingReasons = [];
    if (runningContests.length > 0) {
      blockingReasons.push(`Problem is currently in active running contest: "${runningContests[0].title}" (#${runningContests[0].id})`);
    }
    if (upcomingContests.length > 0) {
      blockingReasons.push(`Problem is attached to upcoming scheduled contest: "${upcomingContests[0].title}" (#${upcomingContests[0].id})`);
    }

    let impactLevel = 'NONE';
    if (runningContests.length > 0 || upcomingContests.length > 0 || totalSubmissions > 100) {
      impactLevel = 'HIGH';
    } else if (contests.length > 0 || totalSubmissions > 0) {
      impactLevel = 'MEDIUM';
    } else if (totalBookmarks > 0) {
      impactLevel = 'LOW';
    }

    return {
      problemId,
      impactLevel,
      canArchive: blockingReasons.length === 0,
      canUnpublish: runningContests.length === 0,
      blockingReasons,
      metrics: {
        totalContestsAttached: contests.length,
        activeContestsCount,
        runningContestsCount: runningContests.length,
        upcomingContestsCount: upcomingContests.length,
        totalSubmissions,
        totalBookmarks,
      },
      contests: contests.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        runtimeState: c.runtimeState,
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    };
  }
}

module.exports = ProblemLifecycleModel;
