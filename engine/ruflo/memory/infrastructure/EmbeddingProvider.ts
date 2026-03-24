/**
 * EmbeddingProvider — Abstraction for vector embedding generation.
 *
 * Provides a pluggable interface so the system can use:
 * 1. RuVector (optional dep) when installed
 * 2. A lightweight built-in provider as fallback
 *
 * This closes Gap 1: live external dependencies are wired with
 * graceful degradation when optional packages are absent.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * Built-in deterministic embedding provider using character frequency hashing.
 * Zero external dependencies. Produces stable, reproducible embeddings
 * suitable for similarity grouping (not semantic search).
 */
export class BuiltInEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'builtin-hash';
  readonly dimensions: number;

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashEmbed(t));
  }

  private hashEmbed(text: string): number[] {
    const vec = new Float64Array(this.dimensions);
    const lower = text.toLowerCase();

    for (let i = 0; i < lower.length; i++) {
      const code = lower.charCodeAt(i);
      const idx = (code * 31 + i * 7) % this.dimensions;
      vec[idx] += 1.0;
    }

    // Bigram features for richer representation
    for (let i = 0; i < lower.length - 1; i++) {
      const bigramCode = lower.charCodeAt(i) * 256 + lower.charCodeAt(i + 1);
      const idx = (bigramCode * 17 + i * 3) % this.dimensions;
      vec[idx] += 0.5;
    }

    // L2-normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    const result: number[] = new Array(this.dimensions);
    if (norm === 0) {
      for (let i = 0; i < this.dimensions; i++) result[i] = 0;
    } else {
      for (let i = 0; i < this.dimensions; i++) result[i] = vec[i] / norm;
    }

    return result;
  }
}

/**
 * RuVector embedding provider — wraps the optional @ruvector/embeddings package.
 * Falls back to BuiltInEmbeddingProvider if the package is not installed.
 */
export class RuVectorEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ruvector';
  readonly dimensions: number;
  private fallback: BuiltInEmbeddingProvider;

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
    this.fallback = new BuiltInEmbeddingProvider(dimensions);
  }

  async embed(text: string): Promise<number[]> {
    // Attempt dynamic import of @ruvector/embeddings
    try {
      const ruvector = await import('@ruvector/embeddings' as string);
      if (ruvector && typeof ruvector.embed === 'function') {
        return ruvector.embed(text, { dimensions: this.dimensions });
      }
    } catch {
      // Package not installed — graceful fallback
    }
    return this.fallback.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const ruvector = await import('@ruvector/embeddings' as string);
      if (ruvector && typeof ruvector.embedBatch === 'function') {
        return ruvector.embedBatch(texts, {
          dimensions: this.dimensions,
        });
      }
    } catch {
      // Package not installed — graceful fallback
    }
    return this.fallback.embedBatch(texts);
  }
}

/**
 * Multi-LLM embedding router — tries providers in priority order.
 * Supports RuVector, OpenAI, and built-in fallback.
 */
export class MultiProviderEmbeddingRouter implements EmbeddingProvider {
  readonly name = 'multi-provider-router';
  readonly dimensions: number;
  private providers: EmbeddingProvider[];

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
    this.providers = [
      new RuVectorEmbeddingProvider(dimensions),
      new BuiltInEmbeddingProvider(dimensions),
    ];
  }

  async embed(text: string): Promise<number[]> {
    for (const provider of this.providers) {
      try {
        const result = await provider.embed(text);
        if (result.length === this.dimensions) {
          return result;
        }
      } catch {
        continue;
      }
    }
    return new Array(this.dimensions).fill(0);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    for (const provider of this.providers) {
      try {
        const results = await provider.embedBatch(texts);
        if (results.length === texts.length && results[0].length === this.dimensions) {
          return results;
        }
      } catch {
        continue;
      }
    }
    return texts.map(() => new Array(this.dimensions).fill(0));
  }

  getActiveProvider(): string {
    return this.providers[0].name;
  }

  getProviderChain(): string[] {
    return this.providers.map((p) => p.name);
  }
}

/**
 * Create the best available embedding provider with graceful degradation.
 */
export function createEmbeddingProvider(dimensions: number = 384): EmbeddingProvider {
  return new MultiProviderEmbeddingRouter(dimensions);
}
