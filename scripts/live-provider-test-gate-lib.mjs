import * as path from 'node:path';

export function hasGitHubConfig(env = process.env) {
  return Boolean(
    (env.GITHUB_TOKEN || env.GH_TOKEN) &&
    env.OMNI_LINK_GITHUB_OWNER &&
    env.OMNI_LINK_GITHUB_REPO &&
    env.OMNI_LINK_GITHUB_PR,
  );
}

export function hasGitLabConfig(env = process.env) {
  return Boolean(
    (env.GITLAB_TOKEN || env.CI_JOB_TOKEN) &&
    env.OMNI_LINK_GITLAB_NAMESPACE &&
    env.OMNI_LINK_GITLAB_PROJECT &&
    env.OMNI_LINK_GITLAB_MR,
  );
}

export function parseGitHubRemote(remoteUrl) {
  const normalized = remoteUrl.trim().replace(/\.git$/, '');
  const match = normalized.match(/github\.com[:/]([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

export function githubToken(env = process.env) {
  return env.GITHUB_TOKEN || env.GH_TOKEN || null;
}

export function gitlabToken(env = process.env) {
  return env.GITLAB_TOKEN || env.CI_JOB_TOKEN || null;
}

function authenticatedGitHubRemote(owner, repo, token) {
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

function gitlabApiUrl(env = process.env) {
  return (env.OMNI_LINK_GITLAB_API_URL || 'https://gitlab.com/api/v4').replace(/\/+$/, '');
}

function authenticatedGitLabRemote(namespace, project, token, env = process.env) {
  const origin = new URL(gitlabApiUrl(env)).origin;
  return `${origin.replace(/\/+$/, '')}/${namespace}/${project}.git`.replace(
    /^https:\/\//,
    `https://oauth2:${token}@`,
  );
}

export function sandboxEnabled(env = process.env) {
  return env.OMNI_LINK_GITHUB_SANDBOX === '1' || env.OMNI_LINK_GITHUB_SANDBOX === 'true';
}

export function gitlabSandboxEnabled(env = process.env) {
  return env.OMNI_LINK_GITLAB_SANDBOX === '1' || env.OMNI_LINK_GITLAB_SANDBOX === 'true';
}

export function skipResult(reason) {
  return {
    code: 0,
    output: {
      status: 'skipped',
      reason,
    },
  };
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function execOutput(execFileSyncImpl, command, args) {
  return execFileSyncImpl(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function originRemote(execFileSyncImpl) {
  try {
    return execOutput(execFileSyncImpl, 'git', ['remote', 'get-url', 'origin']);
  } catch {
    return null;
  }
}

async function githubJson(fetchImpl, token, url, init) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'omni-link',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub sandbox request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

async function gitlabJson(fetchImpl, token, url, init) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      'PRIVATE-TOKEN': token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'omni-link',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab sandbox request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

async function resolveGitLabProject(fetchImpl, token, env = process.env) {
  const namespace = env.OMNI_LINK_GITLAB_NAMESPACE;
  const project = env.OMNI_LINK_GITLAB_PROJECT;
  if (namespace && project) {
    return { namespace, project };
  }

  const apiUrl = gitlabApiUrl(env);
  const projects = await gitlabJson(
    fetchImpl,
    token,
    `${apiUrl}/projects?membership=true&per_page=100&simple=true`,
  );
  if (Array.isArray(projects) && projects.length === 1) {
    return {
      namespace: projects[0]?.namespace?.full_path ?? projects[0]?.namespace?.path,
      project: projects[0]?.path,
    };
  }

  const ownedProjects = await gitlabJson(
    fetchImpl,
    token,
    `${apiUrl}/projects?owned=true&per_page=100&simple=true`,
  );
  if (Array.isArray(ownedProjects) && ownedProjects.length === 1) {
    return {
      namespace: ownedProjects[0]?.namespace?.full_path ?? ownedProjects[0]?.namespace?.path,
      project: ownedProjects[0]?.path,
    };
  }

  return null;
}

export async function runGitHubSandbox({
  env = process.env,
  cwd = process.cwd(),
  execFileSyncImpl,
  spawnSyncImpl,
  fetchImpl,
  fsImpl,
  tmpdir,
}) {
  const token = githubToken(env);
  const remote = originRemote(execFileSyncImpl);
  const parsedRemote = remote ? parseGitHubRemote(remote) : null;

  if (!token || !parsedRemote) {
    return skipResult('github sandbox mode requires a token and a GitHub origin remote');
  }

  const branch = `codex/live-provider-smoke-${Date.now()}`;
  const tempRoot = fsImpl.mkdtempSync(path.join(tmpdir, 'omni-link-github-live-'));
  const clonePath = path.join(tempRoot, 'repo');
  const authenticatedRemote = authenticatedGitHubRemote(
    parsedRemote.owner,
    parsedRemote.repo,
    token,
  );
  let pullRequestNumber = null;

  const cleanup = async () => {
    if (pullRequestNumber !== null) {
      await fetchImpl(
        `https://api.github.com/repos/${parsedRemote.owner}/${parsedRemote.repo}/pulls/${pullRequestNumber}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'omni-link',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({ state: 'closed' }),
        },
      ).catch(() => undefined);
    }

    if (fsImpl.existsSync(clonePath)) {
      spawnSyncImpl('git', ['-C', clonePath, 'push', 'origin', '--delete', branch], {
        stdio: 'ignore',
      });
    }

    fsImpl.rmSync(tempRoot, { recursive: true, force: true });
  };

  try {
    execFileSyncImpl('git', ['clone', '--depth', '1', authenticatedRemote, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'remote', 'set-url', 'origin', authenticatedRemote], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'checkout', '-b', branch], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'config', 'user.name', 'omni-link sandbox'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'config', 'user.email', 'sandbox@omni-link.local'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const sandboxDir = path.join(clonePath, '.omni-link');
    fsImpl.mkdirSync(sandboxDir, { recursive: true });
    fsImpl.writeFileSync(
      path.join(sandboxDir, `${branch.split('/').pop()}.txt`),
      `github sandbox ${branch}\n`,
      'utf8',
    );
    execFileSyncImpl('git', ['-C', clonePath, 'add', '.omni-link'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'commit', '-m', 'test: live provider sandbox'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'push', '-u', 'origin', branch], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pullRequest = await githubJson(
      fetchImpl,
      token,
      `https://api.github.com/repos/${parsedRemote.owner}/${parsedRemote.repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'omni-link live provider sandbox',
          head: branch,
          base: 'main',
          body: 'Ephemeral live provider integration verification.',
          draft: true,
        }),
      },
    );
    pullRequestNumber = pullRequest.number;

    const result = spawnSyncImpl(npmCommand(), ['run', 'test:providers:live'], {
      cwd,
      stdio: 'inherit',
      env: {
        ...env,
        GITHUB_TOKEN: token,
        OMNI_LINK_GITHUB_OWNER: parsedRemote.owner,
        OMNI_LINK_GITHUB_REPO: parsedRemote.repo,
        OMNI_LINK_GITHUB_PR: String(pullRequestNumber),
        OMNI_LINK_LIVE_PUBLISH: 'true',
      },
    });

    if ((result.status ?? 1) !== 0) {
      return {
        code: result.status ?? 1,
        output: {
          status: 'failed',
          mode: 'github-sandbox',
          owner: parsedRemote.owner,
          repo: parsedRemote.repo,
          pullRequestNumber,
        },
      };
    }

    return {
      code: 0,
      output: {
        status: 'passed',
        mode: 'github-sandbox',
        owner: parsedRemote.owner,
        repo: parsedRemote.repo,
        pullRequestNumber,
      },
    };
  } finally {
    await cleanup();
  }
}

export async function runGitLabSandbox({
  env = process.env,
  cwd = process.cwd(),
  execFileSyncImpl,
  spawnSyncImpl,
  fetchImpl,
  fsImpl,
  tmpdir,
}) {
  const token = gitlabToken(env);
  if (!token) {
    return skipResult('gitlab sandbox mode requires a GITLAB_TOKEN or CI_JOB_TOKEN');
  }

  const project = await resolveGitLabProject(fetchImpl, token, env);
  if (!project?.namespace || !project?.project) {
    return skipResult(
      'gitlab sandbox mode requires OMNI_LINK_GITLAB_NAMESPACE/PROJECT or a single accessible project',
    );
  }

  const apiUrl = gitlabApiUrl(env);
  const branch = `codex/live-provider-smoke-${Date.now()}`;
  const tempRoot = fsImpl.mkdtempSync(path.join(tmpdir, 'omni-link-gitlab-live-'));
  const clonePath = path.join(tempRoot, 'repo');
  const authenticatedRemote = authenticatedGitLabRemote(
    project.namespace,
    project.project,
    token,
    env,
  );
  let mergeRequestIid = null;

  const cleanup = async () => {
    if (mergeRequestIid !== null) {
      await fetchImpl(
        `${apiUrl}/projects/${encodeURIComponent(`${project.namespace}/${project.project}`)}/merge_requests/${mergeRequestIid}`,
        {
          method: 'PUT',
          headers: {
            'PRIVATE-TOKEN': token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'omni-link',
          },
          body: JSON.stringify({ state_event: 'close' }),
        },
      ).catch(() => undefined);
    }

    if (fsImpl.existsSync(clonePath)) {
      spawnSyncImpl('git', ['-C', clonePath, 'push', 'origin', '--delete', branch], {
        stdio: 'ignore',
      });
    }

    fsImpl.rmSync(tempRoot, { recursive: true, force: true });
  };

  try {
    execFileSyncImpl('git', ['clone', '--depth', '1', authenticatedRemote, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'remote', 'set-url', 'origin', authenticatedRemote], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'checkout', '-b', branch], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'config', 'user.name', 'omni-link sandbox'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'config', 'user.email', 'sandbox@omni-link.local'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const sandboxDir = path.join(clonePath, '.omni-link');
    fsImpl.mkdirSync(sandboxDir, { recursive: true });
    fsImpl.writeFileSync(
      path.join(sandboxDir, `${branch.split('/').pop()}.txt`),
      `gitlab sandbox ${branch}\n`,
      'utf8',
    );
    execFileSyncImpl('git', ['-C', clonePath, 'add', '.omni-link'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'commit', '-m', 'test: live provider sandbox'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSyncImpl('git', ['-C', clonePath, 'push', '-u', 'origin', branch], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const mergeRequest = await gitlabJson(
      fetchImpl,
      token,
      `${apiUrl}/projects/${encodeURIComponent(`${project.namespace}/${project.project}`)}/merge_requests`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Draft: omni-link live provider sandbox',
          source_branch: branch,
          target_branch: 'main',
          description: 'Ephemeral live provider integration verification.',
          remove_source_branch: true,
        }),
      },
    );
    mergeRequestIid = mergeRequest.iid;

    const result = spawnSyncImpl(npmCommand(), ['run', 'test:providers:live'], {
      cwd,
      stdio: 'inherit',
      env: {
        ...env,
        GITLAB_TOKEN: token,
        OMNI_LINK_GITLAB_NAMESPACE: project.namespace,
        OMNI_LINK_GITLAB_PROJECT: project.project,
        OMNI_LINK_GITLAB_MR: String(mergeRequestIid),
        OMNI_LINK_LIVE_PUBLISH: 'true',
      },
    });

    if ((result.status ?? 1) !== 0) {
      return {
        code: result.status ?? 1,
        output: {
          status: 'failed',
          mode: 'gitlab-sandbox',
          namespace: project.namespace,
          project: project.project,
          mergeRequestIid,
        },
      };
    }

    return {
      code: 0,
      output: {
        status: 'passed',
        mode: 'gitlab-sandbox',
        namespace: project.namespace,
        project: project.project,
        mergeRequestIid,
      },
    };
  } finally {
    await cleanup();
  }
}

export async function runLiveProviderGate({
  env = process.env,
  cwd = process.cwd(),
  execFileSyncImpl,
  spawnSyncImpl,
  fetchImpl,
  fsImpl,
  tmpdir,
}) {
  const configuredProviders = [
    hasGitHubConfig(env) ? 'github' : null,
    hasGitLabConfig(env) ? 'gitlab' : null,
  ].filter(Boolean);

  if (configuredProviders.length > 0) {
    const result = spawnSyncImpl(npmCommand(), ['run', 'test:providers:live'], {
      cwd,
      stdio: 'inherit',
      env,
    });
    return {
      code: result.status ?? 1,
      output: {
        status: (result.status ?? 1) === 0 ? 'passed' : 'failed',
        mode: 'configured',
        providers: configuredProviders,
      },
    };
  }

  const sandboxResults = [];

  if (sandboxEnabled(env)) {
    sandboxResults.push(
      await runGitHubSandbox({
        env,
        cwd,
        execFileSyncImpl,
        spawnSyncImpl,
        fetchImpl,
        fsImpl,
        tmpdir,
      }),
    );
  }

  if (gitlabSandboxEnabled(env)) {
    sandboxResults.push(
      await runGitLabSandbox({
        env,
        cwd,
        execFileSyncImpl,
        spawnSyncImpl,
        fetchImpl,
        fsImpl,
        tmpdir,
      }),
    );
  }

  if (sandboxResults.length === 1) {
    return sandboxResults[0];
  }

  if (sandboxResults.length > 1) {
    const failure = sandboxResults.find((result) => result.code !== 0);
    if (failure) {
      return failure;
    }
    return {
      code: 0,
      output: {
        status: 'passed',
        mode: 'sandbox',
        results: sandboxResults.map((result) => result.output),
      },
    };
  }

  return skipResult('live provider credentials are not configured');
}
