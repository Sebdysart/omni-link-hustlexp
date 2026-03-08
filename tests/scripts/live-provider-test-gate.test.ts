import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  hasGitHubConfig,
  hasGitLabConfig,
  parseGitHubRemote,
  runGitHubSandbox,
  runGitLabSandbox,
  runLiveProviderGate,
} from '../../scripts/live-provider-test-gate-lib.mjs';

describe('live provider test gate library', () => {
  it('detects configured GitHub and GitLab environments', () => {
    expect(
      hasGitHubConfig({
        GITHUB_TOKEN: 'token',
        OMNI_LINK_GITHUB_OWNER: 'acme',
        OMNI_LINK_GITHUB_REPO: 'platform',
        OMNI_LINK_GITHUB_PR: '42',
      }),
    ).toBe(true);
    expect(
      hasGitLabConfig({
        GITLAB_TOKEN: 'token',
        OMNI_LINK_GITLAB_NAMESPACE: 'acme',
        OMNI_LINK_GITLAB_PROJECT: 'platform',
        OMNI_LINK_GITLAB_MR: '7',
      }),
    ).toBe(true);
  });

  it('parses GitHub remote URLs', () => {
    expect(parseGitHubRemote('https://github.com/acme/platform.git')).toEqual({
      owner: 'acme',
      repo: 'platform',
    });
    expect(parseGitHubRemote('git@github.com:acme/platform.git')).toEqual({
      owner: 'acme',
      repo: 'platform',
    });
    expect(parseGitHubRemote('https://example.com/acme/platform.git')).toBeNull();
  });

  it('skips cleanly when live provider credentials are not configured', async () => {
    const result = await runLiveProviderGate({
      env: {},
      cwd: '/tmp/workspace',
      execFileSyncImpl: vi.fn(),
      spawnSyncImpl: vi.fn(),
      fetchImpl: vi.fn(),
      fsImpl: fs,
      tmpdir: os.tmpdir(),
    });

    expect(result).toEqual({
      code: 0,
      output: {
        status: 'skipped',
        reason: 'live provider credentials are not configured',
      },
    });
  });

  it('runs the configured live-provider test path when env vars are present', async () => {
    const spawnSyncImpl = vi.fn().mockReturnValue({ status: 0 });

    const result = await runLiveProviderGate({
      env: {
        GITHUB_TOKEN: 'token',
        OMNI_LINK_GITHUB_OWNER: 'acme',
        OMNI_LINK_GITHUB_REPO: 'platform',
        OMNI_LINK_GITHUB_PR: '42',
      },
      cwd: '/tmp/workspace',
      execFileSyncImpl: vi.fn(),
      spawnSyncImpl,
      fetchImpl: vi.fn(),
      fsImpl: fs,
      tmpdir: os.tmpdir(),
    });

    expect(result).toEqual({
      code: 0,
      output: {
        status: 'passed',
        mode: 'configured',
        providers: ['github'],
      },
    });
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      expect.stringContaining('npm'),
      ['run', 'test:providers:live'],
      expect.objectContaining({
        cwd: '/tmp/workspace',
      }),
    );
  });

  it('provisions and cleans up a GitHub sandbox pull request through injected dependencies', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-live-gate-test-'));
    const execFileSyncImpl = vi.fn((command: string, args: string[]) => {
      const serialized = args.join(' ');
      if (command === 'git' && serialized === 'remote get-url origin') {
        return 'https://github.com/acme/platform.git';
      }
      if (command === 'git' && args[0] === 'clone') {
        fs.mkdirSync(args[args.length - 1], { recursive: true });
        return '';
      }
      if (command === 'git') {
        return '';
      }
      throw new Error(`unexpected command: ${command} ${serialized}`);
    });
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({ number: 123 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      });

    try {
      const result = await runGitHubSandbox({
        env: {
          GITHUB_TOKEN: 'token',
          OMNI_LINK_GITHUB_SANDBOX: 'true',
        },
        cwd: '/tmp/workspace',
        execFileSyncImpl,
        spawnSyncImpl,
        fetchImpl,
        fsImpl: fs,
        tmpdir: tempRoot,
      });

      expect(result).toEqual({
        code: 0,
        output: {
          status: 'passed',
          mode: 'github-sandbox',
          owner: 'acme',
          repo: 'platform',
          pullRequestNumber: 123,
        },
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(execFileSyncImpl).toHaveBeenCalledWith(
        'git',
        [
          '-C',
          expect.stringContaining('/repo'),
          'remote',
          'set-url',
          'origin',
          'https://x-access-token:token@github.com/acme/platform.git',
        ],
        expect.any(Object),
      );
      expect(spawnSyncImpl).toHaveBeenCalledWith(
        expect.stringContaining('npm'),
        ['run', 'test:providers:live'],
        expect.objectContaining({
          env: expect.objectContaining({
            OMNI_LINK_GITHUB_OWNER: 'acme',
            OMNI_LINK_GITHUB_REPO: 'platform',
            OMNI_LINK_GITHUB_PR: '123',
            OMNI_LINK_LIVE_PUBLISH: 'true',
          }),
        }),
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('provisions and cleans up a GitLab sandbox merge request through injected dependencies', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-link-gitlab-live-gate-test-'));
    const execFileSyncImpl = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'clone') {
        fs.mkdirSync(args[args.length - 1], { recursive: true });
        return '';
      }
      if (command === 'git') {
        return '';
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [
          {
            path: 'platform',
            namespace: { path: 'acme', full_path: 'acme' },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({ iid: 77 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
      });

    try {
      const result = await runGitLabSandbox({
        env: {
          GITLAB_TOKEN: 'token',
          OMNI_LINK_GITLAB_SANDBOX: 'true',
        },
        cwd: '/tmp/workspace',
        execFileSyncImpl,
        spawnSyncImpl,
        fetchImpl,
        fsImpl: fs,
        tmpdir: tempRoot,
      });

      expect(result).toEqual({
        code: 0,
        output: {
          status: 'passed',
          mode: 'gitlab-sandbox',
          namespace: 'acme',
          project: 'platform',
          mergeRequestIid: 77,
        },
      });
      expect(execFileSyncImpl).toHaveBeenCalledWith(
        'git',
        [
          '-C',
          expect.stringContaining('/repo'),
          'remote',
          'set-url',
          'origin',
          'https://oauth2:token@gitlab.com/acme/platform.git',
        ],
        expect.any(Object),
      );
      expect(spawnSyncImpl).toHaveBeenCalledWith(
        expect.stringContaining('npm'),
        ['run', 'test:providers:live'],
        expect.objectContaining({
          env: expect.objectContaining({
            OMNI_LINK_GITLAB_NAMESPACE: 'acme',
            OMNI_LINK_GITLAB_PROJECT: 'platform',
            OMNI_LINK_GITLAB_MR: '77',
            OMNI_LINK_LIVE_PUBLISH: 'true',
          }),
        }),
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
