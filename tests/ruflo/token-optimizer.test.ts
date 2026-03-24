import { describe, it, expect } from 'vitest';
import { TokenOptimizer } from '../../engine/ruflo/context/TokenOptimizer.js';

describe('ruflo TokenOptimizer (Gap 4: 30-50% token reduction)', () => {
  describe('deduplication', () => {
    it('removes near-duplicate content', () => {
      const optimizer = new TokenOptimizer({ deduplicationThreshold: 0.7 });
      const result = optimizer.optimize([
        'authentication login endpoint missing rate limiting',
        'authentication login endpoint missing rate limiting check',
        'payment webhook is not idempotent',
      ]);

      expect(result.optimizedContent).toHaveLength(2);
      expect(result.savings).toBeGreaterThan(0);

      const dedupStrategy = result.strategies.find((s) => s.name === 'deduplication');
      expect(dedupStrategy!.itemsAffected).toBe(1);
    });

    it('keeps distinct content', () => {
      const optimizer = new TokenOptimizer();
      const result = optimizer.optimize([
        'Auth bug in login flow',
        'Payment webhook double charge',
        'Onboarding email delay issue',
      ]);

      expect(result.optimizedContent).toHaveLength(3);
    });
  });

  describe('compression', () => {
    it('compresses whitespace in light mode', () => {
      const optimizer = new TokenOptimizer({ compressionLevel: 'light' });
      const result = optimizer.optimize(['This   has   extra   whitespace\n\n\n\nand empty lines']);

      expect(result.optimizedContent[0]).not.toContain('   ');
      expect(result.strategies.find((s) => s.name === 'compression')!.tokensSaved).toBeGreaterThan(
        0,
      );
    });

    it('compresses more aggressively in aggressive mode', () => {
      const optimizer = new TokenOptimizer({
        compressionLevel: 'aggressive',
      });
      const result = optimizer.optimize([
        '## Header\n\n**Bold text** and `code` here\n\n\n\nextra space',
      ]);

      expect(result.optimizedContent[0]).not.toContain('##');
      expect(result.optimizedContent[0]).not.toContain('**');
    });

    it('skips compression when level is none', () => {
      const optimizer = new TokenOptimizer({ compressionLevel: 'none' });
      const input = ['Some   spaced   content'];
      const result = optimizer.optimize(input);

      const compressStrategy = result.strategies.find((s) => s.name === 'compression');
      expect(compressStrategy!.tokensSaved).toBe(0);
    });
  });

  describe('relevance filtering', () => {
    it('drops empty/whitespace content', () => {
      const optimizer = new TokenOptimizer({ relevanceMinScore: 0.1 });
      const result = optimizer.optimize([
        'function authenticate() { ... }',
        '   ',
        '',
        'export class PaymentService { ... }',
      ]);

      expect(result.optimizedContent).toHaveLength(2);
    });

    it('keeps technical content', () => {
      const optimizer = new TokenOptimizer({ relevanceMinScore: 0.3 });
      const result = optimizer.optimize([
        'function handleAuth() throws error on invalid token',
        'export interface PaymentRoute { ... }',
        'critical bug in api endpoint',
      ]);

      expect(result.optimizedContent).toHaveLength(3);
    });
  });

  describe('truncation', () => {
    it('truncates content exceeding max length', () => {
      const optimizer = new TokenOptimizer({ maxContentLength: 50 });
      const longContent = 'x'.repeat(200);
      const result = optimizer.optimize([longContent]);

      expect(result.optimizedContent[0].length).toBeLessThan(200);
      expect(result.optimizedContent[0]).toContain('[truncated]');
    });

    it('leaves short content untouched', () => {
      const optimizer = new TokenOptimizer({ maxContentLength: 1000 });
      const result = optimizer.optimize(['short content']);

      expect(result.optimizedContent[0]).toBe('short content');
    });
  });

  describe('combined optimization', () => {
    it('achieves measurable token savings', () => {
      const optimizer = new TokenOptimizer({
        compressionLevel: 'aggressive',
        deduplicationThreshold: 0.65,
      });

      const verbose = [
        'the authentication endpoint is missing rate limiting protection',
        'the authentication endpoint does not have rate limiting protection',
        'payment   webhook   handler   has   no   idempotency   check\n\n\n\n',
        'the payment webhook handler needs idempotency checking',
        '   ',
        '',
        'function validateToken() checks the JWT expiry',
      ];

      const result = optimizer.optimize(verbose);

      expect(result.savingsPercent).toBeGreaterThan(10);
      expect(result.optimizedContent.length).toBeLessThan(verbose.length);
      expect(result.strategies.length).toBe(4);
    });

    it('reports all strategy contributions', () => {
      const optimizer = new TokenOptimizer();
      const result = optimizer.optimize(['test content']);

      const names = result.strategies.map((s) => s.name);
      expect(names).toContain('deduplication');
      expect(names).toContain('compression');
      expect(names).toContain('relevance-filter');
      expect(names).toContain('truncation');
    });
  });

  describe('optimizeForDigest', () => {
    it('optimizes sections to fit token budget', () => {
      const optimizer = new TokenOptimizer();
      const sections = [
        {
          label: 'API Surface',
          content: 'route /api/auth/login POST handler=loginHandler',
        },
        {
          label: 'Types',
          content: 'interface User { id: string; email: string; }',
        },
        {
          label: 'Findings',
          content: 'critical: missing rate limit on login endpoint',
        },
      ];

      const result = optimizer.optimizeForDigest(sections, 100);
      expect(result).toHaveLength(3);
      result.forEach((s) => expect(s.label).toBeDefined());
    });

    it('returns sections unchanged if within budget', () => {
      const optimizer = new TokenOptimizer();
      const sections = [{ label: 'Small', content: 'tiny' }];

      const result = optimizer.optimizeForDigest(sections, 10000);
      expect(result[0].content).toBe('tiny');
    });
  });

  describe('token estimation', () => {
    it('estimates ~4 chars per token', () => {
      const optimizer = new TokenOptimizer();
      expect(optimizer.estimateTokens('')).toBe(0);
      expect(optimizer.estimateTokens('abcd')).toBe(1);
      expect(optimizer.estimateTokens('abcdefgh')).toBe(2);
    });
  });
});
