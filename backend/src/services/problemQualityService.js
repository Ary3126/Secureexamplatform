/**
 * ProblemQualityService - Deterministic Quality Evaluation, Editorial Intelligence & Similarity Engine
 * 
 * Guarantees:
 * - Deterministic, transparent 0-100 quality scoring
 * - Structured 12-item Editorial Checklist (A-L)
 * - Privacy-Preserving Duplicate Similarity Detection
 * - ZERO exposure of hidden test inputs/outputs, oracle code, or validation generator secrets
 */

/**
 * Tokenize and normalize text for NLP / similarity evaluation
 */
function tokenizeText(text) {
  if (!text || typeof text !== 'string') return [];
  const stopwords = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'could', 'did', 'do',
    'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
    'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
    'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
    'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should',
    'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
    'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
    'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopwords.has(token));
}

/**
 * Calculate Jaccard Token & N-Gram Similarity between two texts (0.0 to 1.0)
 */
function calculateJaccardSimilarity(textA, textB) {
  const tokensA = tokenizeText(textA);
  const tokensB = tokenizeText(textB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0.0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersectionCount = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersectionCount++;
    }
  }

  const unionCount = setA.size + setB.size - intersectionCount;
  if (unionCount <= 0) return 0.0;

  return intersectionCount / unionCount;
}

/**
 * Evaluate Problem Quality & Produce Deterministic Quality Breakdown
 */
function evaluateProblemQuality(problem, testCases = [], validationConfig = null, similarityScore = 0) {
  const breakdown = {
    titleQuality: { score: 0, maxScore: 10, notes: [] },
    statementCompleteness: { score: 0, maxScore: 20, notes: [] },
    difficultyConsistency: { score: 0, maxScore: 10, notes: [] },
    codingModeAndTemplates: { score: 0, maxScore: 15, notes: [] },
    testCoverage: { score: 0, maxScore: 25, notes: [] },
    complexityDocumentation: { score: 0, maxScore: 10, notes: [] },
    similarityRisk: { score: 0, maxScore: 10, notes: [] },
  };

  const title = (problem.title || '').trim();
  const description = (problem.description || '').trim();
  const difficulty = (problem.difficulty || '').toLowerCase();
  const codingMode = (problem.codingMode || problem.coding_mode || 'full_program').toLowerCase();
  const starterTemplates = problem.starterTemplates || problem.starter_templates || {};
  const harnessTemplates = problem.harnessTemplates || problem.harness_templates || {};

  // 1. Title Quality (max 10)
  if (title.length >= 5 && title.length <= 100) {
    breakdown.titleQuality.score += 5;
  } else {
    breakdown.titleQuality.notes.push('Title should be between 5 and 100 characters');
  }

  const genericTitles = /^(untitled|test\s*problem|problem\s*\d+|temp\s*problem|draft\s*problem)$/i;
  if (!genericTitles.test(title)) {
    breakdown.titleQuality.score += 5;
  } else {
    breakdown.titleQuality.notes.push('Title appears generic or placeholder');
  }

  // 2. Statement Completeness (max 20)
  if (description.length >= 80) {
    breakdown.statementCompleteness.score += 5;
  } else {
    breakdown.statementCompleteness.notes.push('Statement is brief; minimum 80 characters recommended');
  }

  const descLower = description.toLowerCase();
  const hasInputSpec = /input\s*(format|specification|data)?/i.test(descLower) || descLower.includes('input');
  const hasOutputSpec = /output\s*(format|specification|data)?/i.test(descLower) || descLower.includes('output');
  const hasConstraints = /constraints|bounds|1\s*<=|0\s*<=|\d+\s*<=\s*[nm]/i.test(descLower);

  if (hasInputSpec) {
    breakdown.statementCompleteness.score += 5;
  } else {
    breakdown.statementCompleteness.notes.push('Input specification section is missing');
  }

  if (hasOutputSpec) {
    breakdown.statementCompleteness.score += 5;
  } else {
    breakdown.statementCompleteness.notes.push('Output specification section is missing');
  }

  if (hasConstraints) {
    breakdown.statementCompleteness.score += 5;
  } else {
    breakdown.statementCompleteness.notes.push('Constraints / boundary definitions are missing');
  }

  // 3. Difficulty Consistency (max 10)
  if (['easy', 'medium', 'hard'].includes(difficulty)) {
    breakdown.difficultyConsistency.score += 10;
  } else {
    breakdown.difficultyConsistency.notes.push('Valid difficulty (easy, medium, hard) must be assigned');
  }

  // 4. Coding Mode & Templates (max 15)
  if (['full_program', 'function'].includes(codingMode)) {
    breakdown.codingModeAndTemplates.score += 5;
  }

  if (codingMode === 'function') {
    const langs = ['python', 'cpp', 'java', 'javascript'];
    const hasStarter = langs.some((l) => starterTemplates[l] && starterTemplates[l].trim());
    const hasHarness = langs.some((l) => harnessTemplates[l] && harnessTemplates[l].trim());

    if (hasStarter) {
      breakdown.codingModeAndTemplates.score += 5;
    } else {
      breakdown.codingModeAndTemplates.notes.push('Function mode requires starter code template for supported languages');
    }

    if (hasHarness) {
      breakdown.codingModeAndTemplates.score += 5;
    } else {
      breakdown.codingModeAndTemplates.notes.push('Function mode requires judge harness template for automated evaluation');
    }
  } else {
    // full program
    breakdown.codingModeAndTemplates.score += 10;
  }

  // 5. Test Coverage (max 25)
  const sampleTests = testCases.filter((tc) => !(tc.isHidden ?? tc.is_hidden));
  const hiddenTests = testCases.filter((tc) => Boolean(tc.isHidden ?? tc.is_hidden));

  if (sampleTests.length >= 1) {
    breakdown.testCoverage.score += 10;
  } else {
    breakdown.testCoverage.notes.push('At least one visible sample test case is required');
  }

  if (hiddenTests.length >= 1) {
    breakdown.testCoverage.score += 10;
  } else {
    breakdown.testCoverage.notes.push('At least one hidden test case is required for grading integrity');
  }

  if (testCases.length >= 3) {
    breakdown.testCoverage.score += 5;
  } else {
    breakdown.testCoverage.notes.push('Recommend at least 3 total test cases to cover edge and boundary cases');
  }

  // 6. Expected Complexity Documentation (max 10)
  const hasComplexityDocs = /o\([0-9nkm\s\^log\+\*\.]+\)|time\s*complexity|space\s*complexity|linear\s*time|constant\s*space/i.test(descLower);
  if (hasComplexityDocs || hasConstraints) {
    breakdown.complexityDocumentation.score += 10;
  } else {
    breakdown.complexityDocumentation.notes.push('Expected time and space complexity is not explicitly documented');
  }

  // 7. Similarity Risk (max 10)
  if (similarityScore < 0.70) {
    breakdown.similarityRisk.score = 10;
  } else if (similarityScore < 0.85) {
    breakdown.similarityRisk.score = 5;
    breakdown.similarityRisk.notes.push(`Moderate similarity (${Math.round(similarityScore * 100)}%) detected against existing problems`);
  } else {
    breakdown.similarityRisk.score = 0;
    breakdown.similarityRisk.notes.push(`High similarity (${Math.round(similarityScore * 100)}%) detected; check for duplication`);
  }

  // Calculate Total Score
  const totalScore = Object.values(breakdown).reduce((sum, cat) => sum + cat.score, 0);

  let qualityLevel = 'NEEDS_IMPROVEMENT';
  if (totalScore >= 85) qualityLevel = 'EXCELLENT';
  else if (totalScore >= 70) qualityLevel = 'GOOD';
  else if (totalScore >= 50) qualityLevel = 'FAIR';

  // Build Structured Editorial Checklist (12 items A-L)
  const checklist = [
    {
      key: 'A',
      name: 'Problem Statement',
      category: 'statement',
      status: description.length >= 80 ? 'PASS' : 'FAIL',
      details: description.length >= 80 ? 'Statement provides sufficient descriptive context.' : 'Statement is too short or empty.',
    },
    {
      key: 'B',
      name: 'Constraints Specification',
      category: 'constraints',
      status: hasConstraints ? 'PASS' : 'WARNING',
      details: hasConstraints ? 'Problem defines numeric constraints and boundaries.' : 'No explicit numeric constraints found.',
    },
    {
      key: 'C',
      name: 'Input Specification',
      category: 'input_spec',
      status: hasInputSpec ? 'PASS' : 'WARNING',
      details: hasInputSpec ? 'Input structure is specified.' : 'Input format section is missing.',
    },
    {
      key: 'D',
      name: 'Output Specification',
      category: 'output_spec',
      status: hasOutputSpec ? 'PASS' : 'WARNING',
      details: hasOutputSpec ? 'Output structure is specified.' : 'Output format section is missing.',
    },
    {
      key: 'E',
      name: 'Examples & Sample Tests',
      category: 'examples',
      status: sampleTests.length >= 1 ? 'PASS' : 'FAIL',
      details: sampleTests.length >= 1 ? `Provides ${sampleTests.length} sample test case(s).` : 'Missing visible sample test cases.',
    },
    {
      key: 'F',
      name: 'Difficulty Classification',
      category: 'difficulty',
      status: ['easy', 'medium', 'hard'].includes(difficulty) ? 'PASS' : 'FAIL',
      details: `Difficulty is set to ${difficulty.toUpperCase() || 'NONE'}.`,
    },
    {
      key: 'G',
      name: 'Complexity Expectations',
      category: 'complexity',
      status: (hasComplexityDocs || hasConstraints) ? 'PASS' : 'WARNING',
      details: (hasComplexityDocs || hasConstraints) ? 'Complexity boundaries are documented.' : 'No expected time/space complexity indicated.',
    },
    {
      key: 'H',
      name: 'Starter Code & Harnesses',
      category: 'code_templates',
      status: (codingMode === 'full_program' || (breakdown.codingModeAndTemplates.score === 15)) ? 'PASS' : 'FAIL',
      details: codingMode === 'function' ? 'Starter templates and judge harnesses are configured.' : 'Full program standard I/O mode active.',
    },
    {
      key: 'I',
      name: 'Test Coverage',
      category: 'test_coverage',
      status: (sampleTests.length >= 1 && hiddenTests.length >= 1) ? 'PASS' : sampleTests.length >= 1 ? 'WARNING' : 'FAIL',
      details: `Includes ${sampleTests.length} sample and ${hiddenTests.length} hidden test case(s).`,
    },
    {
      key: 'J',
      name: 'Edge Cases Coverage',
      category: 'edge_cases',
      status: testCases.length >= 3 ? 'PASS' : 'WARNING',
      details: testCases.length >= 3 ? `Total test case count (${testCases.length}) provides basic edge coverage.` : 'Recommend adding additional test cases for boundary conditions.',
    },
    {
      key: 'K',
      name: 'Security & Secret Leakage',
      category: 'security',
      status: !/(password|jwt|secret_key|api_key)\s*[:=]/i.test(description) ? 'PASS' : 'FAIL',
      details: 'No hardcoded credentials or sensitive secret patterns detected in statement.',
    },
    {
      key: 'L',
      name: 'Duplicate & Similarity Check',
      category: 'similarity',
      status: similarityScore < 0.70 ? 'PASS' : similarityScore < 0.85 ? 'WARNING' : 'FAIL',
      details: `Similarity index is ${Math.round(similarityScore * 100)}% against problem bank.`,
    },
  ];

  return {
    qualityScore: totalScore,
    qualityLevel,
    breakdown,
    checklist,
    summary: {
      totalTestsCount: testCases.length,
      sampleTestsCount: sampleTests.length,
      hiddenTestsCount: hiddenTests.length,
      hasValidationConfig: Boolean(validationConfig && validationConfig.validation_enabled),
      evaluatedVersion: problem.version || 1,
    },
  };
}

/**
 * Compare candidate problem against a list of existing accessible problems
 */
function findProblemSimilarities(candidateProblem, existingProblems = []) {
  const candidateText = `${candidateProblem.title || ''} ${candidateProblem.description || ''}`;
  const matches = [];

  for (const existing of existingProblems) {
    if (existing.id === candidateProblem.id) continue;

    const existingText = `${existing.title || ''} ${existing.description || ''}`;
    const similarity = calculateJaccardSimilarity(candidateText, existingText);

    if (similarity > 0.30) {
      let level = 'LOW';
      if (similarity >= 0.85) level = 'HIGH';
      else if (similarity >= 0.70) level = 'MODERATE';

      matches.push({
        problemId: existing.id,
        title: existing.title,
        difficulty: existing.difficulty,
        accessScope: existing.accessScope || existing.access_scope,
        similarityScore: Math.round(similarity * 100),
        similarityLevel: level,
      });
    }
  }

  matches.sort((a, b) => b.similarityScore - a.similarityScore);

  const topMatch = matches[0] || null;
  const highestSimilarity = topMatch ? topMatch.similarityScore / 100 : 0.0;

  return {
    highestSimilarityScore: Math.round(highestSimilarity * 100),
    similarityLevel: highestSimilarity >= 0.85 ? 'HIGH' : highestSimilarity >= 0.70 ? 'MODERATE' : highestSimilarity >= 0.30 ? 'LOW' : 'NONE',
    matchedProblems: matches.slice(0, 5),
  };
}

module.exports = {
  tokenizeText,
  calculateJaccardSimilarity,
  evaluateProblemQuality,
  findProblemSimilarities,
};
