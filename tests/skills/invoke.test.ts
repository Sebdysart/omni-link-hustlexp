import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('/invoke skill', () => {
  it('skills/invoke/SKILL.md exists with name + description frontmatter', () => {
    const content = read('skills/invoke/SKILL.md');
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('name: invoke');
    expect(content).toMatch(/\ndescription: .+/);
  });

  it('documents its two core behaviors: route/catalog and evidence logging', () => {
    const content = read('skills/invoke/SKILL.md').toLowerCase();
    expect(content).toContain('catalog');
    expect(content).toContain('route');
    expect(content).toContain('evidence');
    // It must point findings at the journal so they accumulate over time.
    expect(content).toContain('docs/invoke-feedback.md');
  });

  it('seeds the feedback journal with the documented entry format', () => {
    expect(existsSync(resolve(process.cwd(), 'docs/invoke-feedback.md'))).toBe(true);
    const journal = read('docs/invoke-feedback.md');
    expect(journal).toContain('GAP');
    expect(journal).toContain('OVERLAP');
    expect(journal).toContain('STALE');
  });

  it('is wired into the using-omni-link registry without dropping legacy guarantees', () => {
    const content = read('skills/using-omni-link/SKILL.md');
    expect(content).toContain('/invoke');
    expect(content).toContain('invoke');
    // Guard the registry refresh: the max-tier section must stay intact.
    for (const phrase of [
      'validator',
      '/verify',
      '/apply',
      'uncertainty-checklist',
      'simulateOnly',
    ]) {
      expect(content).toContain(phrase);
    }
    // Stale version reference must have been refreshed.
    expect(content).not.toContain('omni-link v1.0.0');
  });
});
