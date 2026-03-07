import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const AGENT_FILES = [
  'agents/cross-repo-reviewer.md',
  'agents/evolution-strategist.md',
  'agents/repo-analyst.md',
];

const REQUIRED_PHRASES = [
  'ANTI-HALLUCINATION PROTOCOL',
  'cannot confirm',
  '<thinking>',
  'confidence',
];

describe('Agent anti-hallucination protocol', () => {
  for (const file of AGENT_FILES) {
    it(`${file} contains anti-hallucination protocol`, () => {
      const content = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const phrase of REQUIRED_PHRASES) {
        expect(content.toLowerCase()).toContain(phrase.toLowerCase());
      }
    });
  }

  it('agents/validator.md exists with required sections', () => {
    const content = readFileSync(resolve(process.cwd(), 'agents/validator.md'), 'utf8');
    expect(content).toContain('PASS');
    expect(content).toContain('FAIL');
    expect(content).toContain('INCONCLUSIVE');
    expect(content).toContain('Verdict');
    expect(content).toContain('phantom');
    // Verify tool restriction — validator must be read-only
    expect(content).toContain('tools:');
    expect(content).toContain('- Read');
    expect(content).toContain('- Grep');
    expect(content).toContain('- Glob');
    expect(content).toContain('Iron Laws');
  });

  it('commands/verify.md exists and references validator agent', () => {
    const content = readFileSync(resolve(process.cwd(), 'commands/verify.md'), 'utf8');
    expect(content).toContain('validator');
    expect(content).toContain('PASS');
    expect(content).toContain('FAIL');
    expect(content).toContain('INCONCLUSIVE');
    expect(content).toContain('/scan');
  });

  it('commands/apply.md exists and references simulate-only mode', () => {
    const content = readFileSync(resolve(process.cwd(), 'commands/apply.md'), 'utf8');
    expect(content).toContain('simulateOnly');
    expect(content).toContain('dry-run');
    expect(content).toContain('/verify');
  });

  it('skills/uncertainty-checklist/SKILL.md exists with checklist items', () => {
    const content = readFileSync(
      resolve(process.cwd(), 'skills/uncertainty-checklist/SKILL.md'),
      'utf8',
    );
    expect(content).toContain('verified');
    expect(content).toContain('manifest');
    expect(content).toContain('anti-slop');
    expect(content).toContain('placeholder');
  });

  it('skills/using-omni-link/SKILL.md documents max-tier features', () => {
    const content = readFileSync(resolve(process.cwd(), 'skills/using-omni-link/SKILL.md'), 'utf8');
    expect(content).toContain('validator');
    expect(content).toContain('/verify');
    expect(content).toContain('/apply');
    expect(content).toContain('uncertainty-checklist');
    expect(content).toContain('simulateOnly');
  });

  it('skills/anti-slop-gate/SKILL.md references rule engine', () => {
    const content = readFileSync(resolve(process.cwd(), 'skills/anti-slop-gate/SKILL.md'), 'utf8');
    expect(content).toContain('rule engine');
  });

  it('package.json version is 1.0.0', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.version).toBe('1.0.0');
  });
});
