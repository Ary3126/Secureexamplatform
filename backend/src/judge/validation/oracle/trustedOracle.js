const languageRegistry = require('../../runners');
const HarnessBuilder = require('../../harness/harnessBuilder');

/**
 * TrustedOracle - Platform-controlled oracle to generate verified expected outputs for randomized inputs
 */
class TrustedOracle {
  /**
   * Initialize oracle session with problem context, validation config, and optional reference solution
   * @param {Object} options - { problem, validationConfig }
   */
  constructor({ problem = null, validationConfig = null } = {}) {
    this.problem = problem;
    this.validationConfig = validationConfig;
    this.referenceWorkspace = null;
    this.referenceRunner = null;
    this.isPrepared = false;
  }

  /**
   * Prepare reference solution binary/bytecode in isolated workspace if custom reference code is provided
   */
  async prepare() {
    if (this.isPrepared) return;

    const ref = this.getReferenceSolution();
    if (ref && ref.sourceCode && ref.language) {
      const runner = languageRegistry.getRunner(ref.language);
      if (runner) {
        this.referenceRunner = runner;
        this.referenceWorkspace = await runner.createWorkspace(`oracle_${Date.now()}`);

        const executableCode = HarnessBuilder.buildExecutableCode({
          language: ref.language,
          codingMode: ref.codingMode || 'function',
          sourceCode: ref.sourceCode,
          problem: this.problem,
        });

        await runner.writeSourceCode(this.referenceWorkspace, executableCode);
        const compileRes = await runner.compile({ workspaceDir: this.referenceWorkspace });
        if (!compileRes.isSuccess) {
          throw new Error(`Trusted Oracle Reference Compilation Failed: ${compileRes.errorMessage}`);
        }
      }
    }

    this.isPrepared = true;
  }

  /**
   * Extract configured reference solution from validationConfig or problem
   * @returns {Object|null}
   */
  getReferenceSolution() {
    if (this.validationConfig) {
      if (this.validationConfig.referenceSolution && this.validationConfig.referenceSolution.sourceCode) {
        return this.validationConfig.referenceSolution;
      }
      if (this.validationConfig.generatorConfig && this.validationConfig.generatorConfig.referenceSolution) {
        return this.validationConfig.generatorConfig.referenceSolution;
      }
    }
    return null;
  }

  /**
   * Generate expected output for a given raw input string
   * @param {string} inputData
   * @returns {Promise<string>} Expected output string
   */
  async getExpectedOutput(inputData) {
    if (!this.isPrepared) {
      await this.prepare();
    }

    // 1. If custom reference solution is compiled and running in sandbox
    if (this.referenceRunner && this.referenceWorkspace) {
      const res = await this.referenceRunner.run({
        workspaceDir: this.referenceWorkspace,
        inputData,
        timeLimitMs: 3000,
        memoryLimitMb: 256,
      });

      if (res.status !== 'completed') {
        throw new Error(`Trusted Oracle Execution Failed (${res.status}): ${res.stderr || 'Runtime error in reference solution'}`);
      }

      return res.stdout.trim();
    }

    // 2. Built-in Trusted Algorithmic Oracles
    return this.evaluateBuiltinOracle(inputData);
  }

  /**
   * Built-in algorithmic fallback oracle for standard challenge types
   * @param {string} inputData
   * @returns {string}
   */
  evaluateBuiltinOracle(inputData) {
    const lines = (inputData || '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return '';

    const tokens = inputData.trim().split(/\s+/).filter(Boolean);
    const op = (this.validationConfig?.generatorConfig?.operation || '').toLowerCase();

    // Sum operation (default for two integers or array sum)
    if (op === 'multiply' || op === 'product') {
      if (tokens.length >= 2) {
        const a = BigInt(tokens[0]);
        const b = BigInt(tokens[1]);
        return String(a * b);
      }
    }

    if (op === 'sort') {
      const nums = tokens.map((t) => Number(t)).filter((n) => !isNaN(n));
      nums.sort((a, b) => a - b);
      return nums.join(' ');
    }

    if (op === 'max') {
      const nums = tokens.map((t) => Number(t)).filter((n) => !isNaN(n));
      return String(Math.max(...nums));
    }

    if (op === 'min') {
      const nums = tokens.map((t) => Number(t)).filter((n) => !isNaN(n));
      return String(Math.min(...nums));
    }

    // Default: Sum integers
    if (tokens.length >= 2) {
      const a = BigInt(tokens[0]);
      const b = BigInt(tokens[1]);
      return String(a + b);
    } else if (tokens.length === 1) {
      return tokens[0];
    }

    return '';
  }

  /**
   * Clean up oracle workspace resources
   */
  async cleanup() {
    if (this.referenceRunner && this.referenceWorkspace) {
      try {
        await this.referenceRunner.cleanup(this.referenceWorkspace);
      } catch (err) {
        console.warn('[ORACLE CLEANUP WARNING]', err.message);
      }
      this.referenceWorkspace = null;
      this.referenceRunner = null;
    }
  }
}

module.exports = TrustedOracle;