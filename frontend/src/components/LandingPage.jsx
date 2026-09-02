import React, { useState, useEffect } from 'react';
import {
  Code2,
  Trophy,
  Zap,
  ShieldCheck,
  Cpu,
  CheckCircle,
  ArrowRight,
  Terminal,
  Play,
  Flame,
  Layers,
  Sparkles,
  BookOpen,
  ChevronRight,
  Clock,
} from 'lucide-react';

export default function LandingPage({
  onStartPracticing,
  onExploreProblems,
  onNavigateLogin,
  onNavigateSignup,
  onSelectProblem,
}) {
  const [featuredProblems, setFeaturedProblems] = useState([]);
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [activeCodeTab, setActiveCodeTab] = useState('cpp');

  useEffect(() => {
    fetch('/api/problems')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.problems) {
          setFeaturedProblems(data.problems.slice(0, 4));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingProblems(false));
  }, []);

  const sampleSnippets = {
    cpp: `// Function Solution Mode
#include <vector>
#include <unordered_map>

class Solution {
public:
    std::vector<int> twoSum(std::vector<int>& nums, int target) {
        std::unordered_map<int, int> seen;
        for (int i = 0; i < nums.size(); ++i) {
            int complement = target - nums[i];
            if (seen.count(complement)) {
                return {seen[complement], i};
            }
            seen[nums[i]] = i;
        }
        return {};
    }
};`,
    python: `# Function Solution Mode
class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        seen = {}
        for i, num in enumerate(nums):
            complement = target - num
            if complement in seen:
                return [seen[complement], i]
            seen[num] = i
        return []`,
    java: `// Function Solution Mode
import java.util.HashMap;
import java.util.Map;

class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (seen.containsKey(complement)) {
                return new int[]{seen.get(complement), i};
            }
            seen.put(nums[i], i);
        }
        return new int[0];
    }
}`,
  };

  const getDifficultyClass = (diff) => {
    switch (diff?.toLowerCase()) {
      case 'easy':
        return 'diff-easy';
      case 'medium':
        return 'diff-medium';
      case 'hard':
        return 'diff-hard';
      default:
        return 'diff-easy';
    }
  };

  return (
    <div className="landing-container">
      {/* 1. Hero Section */}
      <section className="landing-hero-section">
        <div className="hero-content-wrapper">
          <div className="hero-text-col">
            <div className="hero-badge">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Next-Gen Competitive Programming & Examination</span>
            </div>

            <h1 className="hero-headline">
              Master Algorithms.<br />
              <span className="hero-gradient-text">Practice. Compete. Improve.</span>
            </h1>

            <p className="hero-description">
              Elevate your coding capabilities with interactive problem solving, automated judge verdicts in C++, Python, and Java, real-time contests, and locked-environment examination readiness.
            </p>

            <div className="hero-cta-group">
              <button className="btn btn-primary hero-primary-btn" onClick={onStartPracticing}>
                <span>Start Practicing</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button className="btn btn-secondary hero-secondary-btn" onClick={onExploreProblems}>
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span>Explore Problems</span>
              </button>
            </div>

            <div className="hero-highlights-list">
              <div className="hero-highlight-item">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span>C++, Python & Java</span>
              </div>
              <div className="hero-highlight-item">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span>Live Contest Standings</span>
              </div>
              <div className="hero-highlight-item">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span>Clean Function Mode</span>
              </div>
            </div>
          </div>

          {/* Hero Interactive Code/Terminal Showcase */}
          <div className="hero-visual-col">
            <div className="hero-code-card">
              <div className="code-card-header">
                <div className="code-card-dots">
                  <span className="dot dot-red"></span>
                  <span className="dot dot-yellow"></span>
                  <span className="dot dot-green"></span>
                </div>
                <div className="code-card-tabs">
                  <button
                    className={`code-tab-btn ${activeCodeTab === 'cpp' ? 'active' : ''}`}
                    onClick={() => setActiveCodeTab('cpp')}
                  >
                    Solution.cpp
                  </button>
                  <button
                    className={`code-tab-btn ${activeCodeTab === 'python' ? 'active' : ''}`}
                    onClick={() => setActiveCodeTab('python')}
                  >
                    solution.py
                  </button>
                  <button
                    className={`code-tab-btn ${activeCodeTab === 'java' ? 'active' : ''}`}
                    onClick={() => setActiveCodeTab('java')}
                  >
                    Solution.java
                  </button>
                </div>
                <div className="code-card-mode-badge">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>Interactive Judge</span>
                </div>
              </div>

              <div className="code-card-body">
                <pre className="code-preview-block">
                  <code>{sampleSnippets[activeCodeTab]}</code>
                </pre>
              </div>

              <div className="code-card-footer">
                <div className="status-indicator-row">
                  <span className="status-dot-pulse"></span>
                  <span className="status-label">Online Judge Ready • Docker Sandboxed</span>
                </div>
                <button className="btn btn-success btn-sm" onClick={onStartPracticing}>
                  <Play className="w-3.5 h-3.5" />
                  <span>Run in Workspace</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Platform Features Grid */}
      <section className="landing-features-section">
        <div className="section-header-block">
          <h2 className="section-title">Built for Serious Competitive Coders</h2>
          <p className="section-subtitle">
            Engineered from the ground up for speed, accuracy, and rigorous evaluation.
          </p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon-box icon-blue">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="feature-card-title">Sandboxed Online Judge</h3>
            <p className="feature-card-text">
              Multi-language isolated execution for C++ (GCC 17), Python 3.12, and Java 17 with strict time and memory limits.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box icon-purple">
              <Trophy className="w-6 h-6" />
            </div>
            <h3 className="feature-card-title">Competitive Contests</h3>
            <p className="feature-card-text">
              Participate in scheduled coding sprints, solve problem sets in order, and track real-time score evaluations.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box icon-emerald">
              <Code2 className="w-6 h-6" />
            </div>
            <h3 className="feature-card-title">Dual Coding Modes</h3>
            <p className="feature-card-text">
              Practice in Function Mode without I/O boilerplate or full script mode for standard competitive programming.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box icon-amber">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="feature-card-title">Testcase Suite & Custom Inputs</h3>
            <p className="feature-card-text">
              Run against curated public sample test cases, inspect outputs and execution times, or supply your own custom inputs.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box icon-cyan">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="feature-card-title">Secure & Exam Ready</h3>
            <p className="feature-card-text">
              Role-based access control, active session integrity, and parameterized execution safety for academic exams and contests.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon-box icon-rose">
              <Cpu className="w-6 h-6" />
            </div>
            <h3 className="feature-card-title">Detailed Analytics</h3>
            <p className="feature-card-text">
              Review your submission history, verdict breakdowns (Accepted, Wrong Answer, TLE), and track solved problems.
            </p>
          </div>
        </div>
      </section>

      {/* 3. Featured Problems Section */}
      <section className="landing-problems-section">
        <div className="section-header-row">
          <div>
            <h2 className="section-title">Popular Challenges</h2>
            <p className="section-subtitle">Sharpen your algorithmic thinking with curated problem sets</p>
          </div>
          <button className="btn btn-outline" onClick={onExploreProblems}>
            <span>View All Problems</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {loadingProblems ? (
          <div className="problems-loading-grid">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="problem-card-skeleton" />
            ))}
          </div>
        ) : (
          <div className="featured-problems-grid">
            {featuredProblems.map((prob) => (
              <div key={prob.id} className="featured-problem-card">
                <div className="prob-card-header">
                  <h3 className="prob-card-title">{prob.title}</h3>
                  <span className={`diff-pill ${getDifficultyClass(prob.difficulty)}`}>
                    {prob.difficulty ? prob.difficulty.toUpperCase() : 'MEDIUM'}
                  </span>
                </div>
                <p className="prob-card-desc">
                  {prob.description ? prob.description.slice(0, 120) + '...' : 'Algorithmic challenge with sample testcases.'}
                </p>
                <div className="prob-card-footer">
                  <span className="prob-mode-tag">Function Mode</span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      if (onSelectProblem) onSelectProblem(prob.id);
                      onStartPracticing();
                    }}
                  >
                    <span>Solve Challenge</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Ready to Code CTA Section */}
      <section className="landing-cta-banner">
        <div className="cta-banner-card">
          <div className="cta-banner-content">
            <h2 className="cta-title">Ready to Test Your Algorithmic Skills?</h2>
            <p className="cta-text">
              Join students and competitive coders on SecureJudge. Practice problem sets, participate in live contests, and track your coding journey.
            </p>
            <div className="cta-btn-row">
              <button className="btn btn-primary" onClick={onNavigateSignup}>
                <span>Create Student Account</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button className="btn btn-outline" onClick={onNavigateLogin}>
                <span>Sign In to Existing Account</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Footer */}
      <footer className="landing-footer">
        <div className="footer-content-wrapper">
          <div className="footer-brand-col">
            <div className="footer-brand">
              <ShieldCheck className="w-5 h-5 text-blue-500" />
              <span>SecureJudge</span>
            </div>
            <p className="footer-tagline">
              Secure Competitive Programming & Examination Platform.
            </p>
          </div>

          <div className="footer-links-grid">
            <div className="footer-links-col">
              <h4>Platform</h4>
              <button className="footer-link-btn" onClick={onStartPracticing}>Workspace Editor</button>
              <button className="footer-link-btn" onClick={onExploreProblems}>Problem Bank</button>
              <button className="footer-link-btn" onClick={onExploreProblems}>Contests</button>
            </div>
            <div className="footer-links-col">
              <h4>Account</h4>
              <button className="footer-link-btn" onClick={onNavigateLogin}>Sign In</button>
              <button className="footer-link-btn" onClick={onNavigateSignup}>Create Account</button>
            </div>
            <div className="footer-links-col">
              <h4>Languages</h4>
              <span className="footer-static-item">C++ (GCC 17)</span>
              <span className="footer-static-item">Python (3.12)</span>
              <span className="footer-static-item">Java (OpenJDK 17)</span>
            </div>
          </div>
        </div>

        <div className="footer-bottom-bar">
          <span>&copy; {new Date().getFullYear()} SecureJudge Platform. All rights reserved.</span>
          <div className="footer-bottom-badges">
            <span className="system-pill-live">
              <span className="live-pulse"></span>
              Judge Online
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
