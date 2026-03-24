import { describe, it, expect } from 'vitest';
import { runCli } from '../../engine/cli-app.js';

describe('CLI swarm command (Fix 1+5: ruflo runtime-live via CLI)', () => {
  it('returns ruflo engine status with all subsystems', async () => {
    const output: string[] = [];
    const exitCode = await runCli(['swarm'], {
      stdout: (msg: string) => output.push(msg),
      stderr: () => {},
    });

    expect(exitCode).toBe(0);
    expect(output.length).toBe(1);

    const status = JSON.parse(output[0]);
    expect(status.engine).toBe('ruflo');
    expect(status.version).toBe('3.0.0');
    expect(status.topology).toBe('hierarchical');
    expect(status.plugins).toHaveLength(1);
    expect(status.plugins[0].id).toBe('hustlexp-engineering');
    expect(status.memory.type).toBe('hybrid');
    expect(status.memory.backends).toContain('sqlite');
    expect(status.memory.backends).toContain('agentdb');
    expect(status.embedding.provider).toBe('multi-provider-router');
    expect(status.embedding.dimensions).toBe(384);
    expect(status.tokenOptimizer.strategies).toHaveLength(4);
    expect(status.selfLearning.domains).toBe(3);
    expect(status.authority).toHaveProperty('hasAuthorityDrift');
    expect(status.bridge).toHaveProperty('swiftCalls');
    expect(status.capabilities).toContain('swarm-coordination');
    expect(status.capabilities).toContain('workflow-execution');
    expect(status.capabilities).toContain('hybrid-vector-memory');
    expect(status.capabilities).toContain('self-learning-loop');
    expect(status.capabilities).toContain('token-optimization');
  });
});
