import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resolveConfigPath, validateConfig, DEFAULT_CONFIG } from '../engine/config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('config', () => {
  const tmpDir = path.join(os.tmpdir(), 'omni-link-test-config');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolveConfigPath finds local .omni-link.json first', () => {
    const localConfig = path.join(tmpDir, '.omni-link.json');
    fs.writeFileSync(localConfig, '{}');
    const result = resolveConfigPath(tmpDir);
    expect(result).toBe(localConfig);
  });

  it('resolveConfigPath returns null if no config found', () => {
    // Pass a fake homeDir so the function cannot fall through to the real
    // ~/.claude/omni-link.json that may exist on the developer's machine.
    const fakeHome = path.join(os.tmpdir(), 'omni-link-test-fake-home');
    const result = resolveConfigPath(tmpDir, fakeHome);
    expect(result).toBeNull();
  });

  it('validateConfig rejects empty repos array', () => {
    const result = validateConfig({ repos: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('repos: must have at least 1 repo');
  });

  it('validateConfig rejects more than 10 repos', () => {
    const repos = Array.from({ length: 11 }, (_, i) => ({
      name: `repo-${i}`,
      path: `/tmp/repo-${i}`,
      language: 'typescript',
      role: 'backend',
    }));
    const result = validateConfig({ repos });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('repos: maximum 10 repos allowed');
  });

  it('validateConfig accepts valid config', () => {
    const result = validateConfig({
      repos: [{ name: 'test', path: '/tmp/test', language: 'typescript', role: 'backend' }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('loadConfig merges with defaults', () => {
    const configPath = path.join(tmpDir, '.omni-link.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ name: 'test', path: '/tmp/test', language: 'typescript', role: 'backend' }],
      }),
    );
    const config = loadConfig(configPath);
    expect(config.repos).toHaveLength(1);
    expect(config.evolution.aggressiveness).toBe(DEFAULT_CONFIG.evolution.aggressiveness);
    expect(config.context.tokenBudget).toBe(DEFAULT_CONFIG.context.tokenBudget);
    expect(config.reviewProvider).toBe(DEFAULT_CONFIG.reviewProvider);
  });

  it('normalizes legacy evolution category names', () => {
    const configPath = path.join(tmpDir, '.omni-link.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ name: 'test', path: '/tmp/test', language: 'typescript', role: 'backend' }],
        evolution: { categories: ['features', 'performance'] },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.evolution.categories).toEqual(['feature', 'performance']);
  });

  it('loadConfig throws on invalid JSON', () => {
    const configPath = path.join(tmpDir, '.omni-link.json');
    fs.writeFileSync(configPath, 'not json');
    expect(() => loadConfig(configPath)).toThrow();
  });

  it('loadConfig supports provider selection and GitLab defaults', () => {
    const configPath = path.join(tmpDir, '.omni-link.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ name: 'test', path: '/tmp/test', language: 'typescript', role: 'backend' }],
        reviewProvider: 'gitlab',
        gitlab: {
          enabled: true,
          namespace: 'acme',
          project: 'platform',
        },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.reviewProvider).toBe('gitlab');
    expect(config.gitlab?.namespace).toBe('acme');
    expect(config.gitlab?.project).toBe('platform');
    expect(config.gitlab?.publishMode).toBe(DEFAULT_CONFIG.gitlab?.publishMode);
  });

  it('loadConfig extends max-tier semantic languages to Java and Swift', () => {
    const configPath = path.join(tmpDir, '.omni-link.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        repos: [{ name: 'test', path: '/tmp/test', language: 'typescript', role: 'backend' }],
        maxTier: {
          enabled: true,
          semanticAnalysis: {
            enabled: true,
          },
        },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.maxTier?.semanticAnalysis?.languages).toEqual(
      expect.arrayContaining(['typescript', 'python', 'go', 'graphql', 'java', 'swift']),
    );
  });

  it('validateConfig accepts workflow profile authority and bridge settings', () => {
    const result = validateConfig({
      workflowProfile: 'hustlexp',
      repos: [
        {
          name: 'hustlexp-ios',
          path: '/tmp/ios',
          language: 'swift',
          role: 'ios-client',
          exclude: ['screenshots/'],
        },
        {
          name: 'hustlexp-backend',
          path: '/tmp/backend',
          language: 'typescript',
          role: 'backend-api',
        },
      ],
      authority: {
        enabled: true,
        docsRepo: '/tmp/docs',
        phaseMode: 'reconciliation',
        authorityFiles: {
          currentPhase: 'CURRENT_PHASE.md',
          finishedState: 'FINISHED_STATE.md',
          featureFreeze: 'FEATURE_FREEZE.md',
          aiGuardrails: 'AI_GUARDRAILS.md',
          apiContract: 'specs/04-backend/API_CONTRACT.md',
          schema: 'specs/02-architecture/schema.sql',
        },
      },
      bridges: {
        swiftTrpc: {
          enabled: true,
          iosRepo: '/tmp/ios',
          backendRepo: '/tmp/backend',
          clientCallPattern: 'trpc',
          authoritativeBackendRoot: 'backend/src',
        },
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('loadConfig applies HustleXP workflow defaults', () => {
    const configPath = path.join(tmpDir, '.omni-link.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        workflowProfile: 'hustlexp',
        repos: [
          { name: 'hustlexp-ios', path: '/tmp/ios', language: 'swift', role: 'ios-client' },
          {
            name: 'hustlexp-backend',
            path: '/tmp/backend',
            language: 'typescript',
            role: 'backend-api',
          },
          {
            name: 'hustlexp-docs',
            path: '/tmp/docs',
            language: 'javascript',
            role: 'product-governance',
          },
        ],
      }),
    );

    const config = loadConfig(configPath);

    expect(config.authority?.enabled).toBe(true);
    expect(config.authority?.docsRepo).toBe('/tmp/docs');
    expect(config.bridges?.swiftTrpc?.enabled).toBe(true);
    expect(config.bridges?.swiftTrpc?.iosRepo).toBe('/tmp/ios');
    expect(config.daemon?.preferDaemon).toBe(true);
    expect(config.policies?.requiredChecks).toEqual(
      expect.arrayContaining(['ios-build', 'backend-tests', 'contract-sync']),
    );
    expect(config.repos[0].exclude).toEqual(expect.arrayContaining(['*.png', 'node_modules/']));
    expect(config.context.focus).toBe('mismatches');
    expect(config.simulateOnly).toBe(true);
  });
});
