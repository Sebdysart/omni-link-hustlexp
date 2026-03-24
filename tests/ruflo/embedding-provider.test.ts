import { describe, it, expect } from 'vitest';
import {
  BuiltInEmbeddingProvider,
  RuVectorEmbeddingProvider,
  MultiProviderEmbeddingRouter,
  createEmbeddingProvider,
} from '../../engine/ruflo/memory/infrastructure/EmbeddingProvider.js';

describe('ruflo EmbeddingProvider (Gap 1: live external deps)', () => {
  describe('BuiltInEmbeddingProvider', () => {
    it('produces embeddings of the correct dimension', async () => {
      const provider = new BuiltInEmbeddingProvider(128);
      const embedding = await provider.embed('Hello world');

      expect(embedding).toHaveLength(128);
      expect(provider.dimensions).toBe(128);
      expect(provider.name).toBe('builtin-hash');
    });

    it('produces deterministic embeddings', async () => {
      const provider = new BuiltInEmbeddingProvider(64);
      const a = await provider.embed('test input');
      const b = await provider.embed('test input');

      expect(a).toEqual(b);
    });

    it('produces different embeddings for different inputs', async () => {
      const provider = new BuiltInEmbeddingProvider(64);
      const a = await provider.embed('apple');
      const b = await provider.embed('banana');

      expect(a).not.toEqual(b);
    });

    it('produces L2-normalized vectors', async () => {
      const provider = new BuiltInEmbeddingProvider(64);
      const embedding = await provider.embed('normalize me');

      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

      expect(norm).toBeCloseTo(1.0, 3);
    });

    it('handles empty string', async () => {
      const provider = new BuiltInEmbeddingProvider(64);
      const embedding = await provider.embed('');

      expect(embedding).toHaveLength(64);
      expect(embedding.every((v) => v === 0)).toBe(true);
    });

    it('embeds batches', async () => {
      const provider = new BuiltInEmbeddingProvider(64);
      const results = await provider.embedBatch(['hello', 'world', 'test']);

      expect(results).toHaveLength(3);
      expect(results[0]).toHaveLength(64);
      expect(results[1]).toHaveLength(64);
      expect(results[2]).toHaveLength(64);
    });

    it('preserves similarity for related inputs', async () => {
      const provider = new BuiltInEmbeddingProvider(384);
      const auth1 = await provider.embed('authentication login password');
      const auth2 = await provider.embed('authentication login token');
      const fin = await provider.embed('payment invoice billing');

      const similarity = (a: number[], b: number[]): number => {
        let dot = 0;
        for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
        return dot;
      };

      const authSimilarity = similarity(auth1, auth2);
      const crossSimilarity = similarity(auth1, fin);

      expect(authSimilarity).toBeGreaterThan(crossSimilarity);
    });
  });

  describe('RuVectorEmbeddingProvider', () => {
    it('falls back to built-in when @ruvector/embeddings is not installed', async () => {
      const provider = new RuVectorEmbeddingProvider(64);
      const embedding = await provider.embed('test');

      expect(embedding).toHaveLength(64);
      expect(provider.name).toBe('ruvector');
    });

    it('falls back gracefully for batch embedding', async () => {
      const provider = new RuVectorEmbeddingProvider(64);
      const results = await provider.embedBatch(['a', 'b']);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(64);
    });
  });

  describe('MultiProviderEmbeddingRouter', () => {
    it('routes through provider chain', async () => {
      const router = new MultiProviderEmbeddingRouter(128);
      const embedding = await router.embed('test routing');

      expect(embedding).toHaveLength(128);
      expect(router.name).toBe('multi-provider-router');
    });

    it('reports provider chain', () => {
      const router = new MultiProviderEmbeddingRouter(64);
      const chain = router.getProviderChain();

      expect(chain).toContain('ruvector');
      expect(chain).toContain('builtin-hash');
    });

    it('batch embeds through the chain', async () => {
      const router = new MultiProviderEmbeddingRouter(64);
      const results = await router.embedBatch(['x', 'y', 'z']);

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r).toHaveLength(64));
    });
  });

  describe('createEmbeddingProvider', () => {
    it('creates a working provider with default dimensions', async () => {
      const provider = createEmbeddingProvider();
      const embedding = await provider.embed('factory test');

      expect(embedding).toHaveLength(384);
    });

    it('creates a working provider with custom dimensions', async () => {
      const provider = createEmbeddingProvider(768);
      const embedding = await provider.embed('custom dims');

      expect(embedding).toHaveLength(768);
    });
  });
});
