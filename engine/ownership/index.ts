import type {
  EcosystemGraph,
  OmniLinkConfig,
  OwnerAssignment,
  OwnershipRule,
  RepoManifest,
} from '../types.js';

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) return false;
  return patternToRegex(pattern).test(value);
}

function repoFiles(manifest: RepoManifest): string[] {
  return [
    ...manifest.apiSurface.exports.map((entry) => entry.file),
    ...manifest.apiSurface.routes.map((entry) => entry.file),
    ...manifest.apiSurface.procedures.map((entry) => entry.file),
    ...manifest.typeRegistry.types.map((entry) => entry.source.file),
    ...manifest.typeRegistry.schemas.map((entry) => entry.source.file),
  ];
}

function ruleMatchesManifest(rule: OwnershipRule, manifest: RepoManifest): string | null {
  switch (rule.scope) {
    case 'repo':
      if (
        rule.repo === manifest.repoId ||
        (rule.pattern && matchesPattern(manifest.repoId, rule.pattern))
      ) {
        return `repo:${manifest.repoId}`;
      }
      return null;
    case 'path': {
      if (!rule.pattern) return null;
      const matchedFile = repoFiles(manifest).find((file) => matchesPattern(file, rule.pattern!));
      return matchedFile ? `path:${matchedFile}` : null;
    }
    case 'api': {
      if (!rule.pattern) return null;
      const matchedRoute = manifest.apiSurface.routes.find((route) =>
        matchesPattern(route.path, rule.pattern!),
      );
      if (matchedRoute) {
        return `api:${matchedRoute.path}`;
      }
      const matchedProcedure = manifest.apiSurface.procedures.find((procedure) =>
        matchesPattern(procedure.name, rule.pattern!),
      );
      return matchedProcedure ? `procedure:${matchedProcedure.name}` : null;
    }
    case 'package': {
      if (!rule.pattern) return null;
      const matchedPackage = manifest.dependencies.external.find((dependency) =>
        matchesPattern(dependency.name, rule.pattern!),
      );
      return matchedPackage ? `package:${matchedPackage.name}` : null;
    }
  }
}

function dedupeOwners(owners: OwnerAssignment[]): OwnerAssignment[] {
  const unique = new Map<string, OwnerAssignment>();

  for (const owner of owners) {
    const key = `${owner.owner}:${owner.kind}:${owner.scope}:${owner.repoId ?? ''}:${owner.pattern ?? ''}`;
    if (!unique.has(key)) {
      unique.set(key, owner);
    }
  }

  return [...unique.values()];
}

export function resolveManifestOwners(
  manifest: RepoManifest,
  config: OmniLinkConfig,
): OwnerAssignment[] {
  const ownership = config.ownership;
  if (!ownership?.enabled) {
    return ownership?.defaultOwner
      ? [
          {
            owner: ownership.defaultOwner,
            kind: 'team',
            scope: 'repo',
            repoId: manifest.repoId,
            matchedBy: 'ownership.defaultOwner',
          },
        ]
      : [];
  }

  const matchedOwners = (ownership.rules ?? []).flatMap((rule) => {
    const matchedBy = ruleMatchesManifest(rule, manifest);
    if (!matchedBy) return [];

    return [
      {
        owner: rule.owner,
        kind: rule.kind,
        scope: rule.scope,
        repoId: manifest.repoId,
        pattern: rule.pattern,
        matchedBy,
      } satisfies OwnerAssignment,
    ];
  });

  if (matchedOwners.length > 0) {
    return dedupeOwners(matchedOwners);
  }

  return ownership.defaultOwner
    ? [
        {
          owner: ownership.defaultOwner,
          kind: 'team',
          scope: 'repo',
          repoId: manifest.repoId,
          matchedBy: 'ownership.defaultOwner',
        },
      ]
    : [];
}

export function attachOwnersToGraph(graph: EcosystemGraph, config: OmniLinkConfig): EcosystemGraph {
  const repos = graph.repos.map((manifest) => ({
    ...manifest,
    owners: resolveManifestOwners(manifest, config),
  }));
  const owners = dedupeOwners(repos.flatMap((manifest) => manifest.owners ?? []));

  return {
    ...graph,
    repos,
    owners,
  };
}
