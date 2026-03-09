import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AuthorityState, OmniLinkConfig, EcosystemGraph, ReviewFinding } from '../types.js';

function readTextIfPresent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function resolveAuthorityFile(docsRepo: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(docsRepo, filePath);
}

function extractListSection(markdown: string, headingPattern: RegExp): string[] {
  const match = headingPattern.exec(markdown);
  if (!match) return [];

  const start = match.index + match[0].length;
  const nextHeadingIndex = markdown.slice(start).search(/^##\s+/m);
  const body =
    nextHeadingIndex === -1
      ? markdown.slice(start)
      : markdown.slice(start, start + nextHeadingIndex);

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith('- ') ||
        line.startsWith('❌ ') ||
        line.startsWith('✅ ') ||
        /^\d+\./.test(line),
    )
    .map((line) =>
      line
        .replace(/^[-❌✅]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .trim(),
    )
    .filter(Boolean);
}

function extractCurrentPhase(markdown: string): string {
  const match = markdown.match(/^#\s*CURRENT PHASE:\s*(.+)$/m);
  if (match) {
    return match[1].trim();
  }

  const fallback = markdown.match(/CURRENT:\s*([A-Za-z0-9 _-]+)/);
  return fallback?.[1]?.trim() ?? 'UNKNOWN';
}

function extractApiProcedures(markdown: string): string[] {
  return [...markdown.matchAll(/^###\s+([A-Za-z0-9_]+\.[A-Za-z0-9_]+)/gm)].map((match) => match[1]);
}

function extractBaseUrls(markdown: string): string[] {
  return [...markdown.matchAll(/^(Production|Development):\s*(.+)$/gm)].map((match) =>
    match[2].trim(),
  );
}

function extractErrorCodes(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\|\s*([A-Z_0-9]+)\s*\|/g)].map((match) => match[1]))];
}

function extractSchemaObjects(sql: string, kind: 'TABLE' | 'VIEW'): string[] {
  const pattern = new RegExp(
    `CREATE\\s+${kind}\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\\.)?([A-Za-z_][A-Za-z0-9_]*)`,
    'gi',
  );
  return [...new Set([...sql.matchAll(pattern)].map((match) => match[1]))];
}

function finding(
  severity: ReviewFinding['severity'],
  title: string,
  description: string,
  repo: string,
  file: string,
  line = 1,
): ReviewFinding {
  return {
    kind: 'authority_drift',
    severity,
    title,
    description,
    repo,
    file,
    line,
    sourceKind: 'mixed',
    confidence: severity === 'breaking' ? 0.95 : 0.85,
    riskScore: severity === 'breaking' ? 95 : severity === 'warning' ? 68 : 28,
    provenance: [
      {
        sourceKind: 'mixed',
        adapter: 'hustlexp-authority',
        detail: 'docs authority drift',
        confidence: severity === 'breaking' ? 0.95 : 0.85,
      },
    ],
  };
}

export function loadAuthorityState(config: OmniLinkConfig): AuthorityState | null {
  if (
    !config.authority?.enabled ||
    !config.authority.docsRepo ||
    !config.authority.authorityFiles
  ) {
    return null;
  }

  const docsRepo = config.authority.docsRepo;
  const files = config.authority.authorityFiles;
  const currentPhasePath = resolveAuthorityFile(docsRepo, files.currentPhase);
  const finishedStatePath = resolveAuthorityFile(docsRepo, files.finishedState);
  const featureFreezePath = resolveAuthorityFile(docsRepo, files.featureFreeze);
  const aiGuardrailsPath = resolveAuthorityFile(docsRepo, files.aiGuardrails);
  const apiContractPath = resolveAuthorityFile(docsRepo, files.apiContract);
  const schemaPath = resolveAuthorityFile(docsRepo, files.schema);

  const currentPhase = readTextIfPresent(currentPhasePath);
  const finishedState = readTextIfPresent(finishedStatePath);
  const featureFreeze = readTextIfPresent(featureFreezePath);
  const aiGuardrails = readTextIfPresent(aiGuardrailsPath);
  const apiContract = readTextIfPresent(apiContractPath);
  const schemaSql = readTextIfPresent(schemaPath);

  if (
    !currentPhase &&
    !finishedState &&
    !featureFreeze &&
    !aiGuardrails &&
    !apiContract &&
    !schemaSql
  ) {
    return null;
  }

  return {
    docsRepo,
    phaseMode: config.authority.phaseMode ?? 'reconciliation',
    currentPhase: extractCurrentPhase(currentPhase),
    blockedWorkClasses: extractListSection(
      currentPhase,
      /^##\s*Frontend.*?BLOCKED UNTIL BOOTSTRAP PASSES:|^##\s*BLOCKED UNTIL.*$/ms,
    ),
    frozenFeatures: [
      ...extractListSection(featureFreeze, /^##\s*Disallowed.*$/m),
      ...extractListSection(finishedState, /^##\s*Does NOT Include.*$/m),
      ...extractListSection(aiGuardrails, /^##\s*Stop Conditions.*$/m),
    ].slice(0, 25),
    authoritativeApiSurface: {
      sourceFile: apiContractPath,
      procedures: extractApiProcedures(apiContract),
      errorCodes: extractErrorCodes(apiContract),
      baseUrls: extractBaseUrls(apiContract),
      sourceKind: 'mixed',
      confidence: 0.92,
    },
    authoritativeSchemaSurface: {
      sourceFile: schemaPath,
      tables: extractSchemaObjects(schemaSql, 'TABLE'),
      views: extractSchemaObjects(schemaSql, 'VIEW'),
      sourceKind: 'mixed',
      confidence: 0.92,
    },
    sourceKind: 'mixed',
    confidence: 0.92,
    provenance: [
      {
        sourceKind: 'mixed',
        adapter: 'hustlexp-authority',
        detail: 'docs governance repository',
        confidence: 0.92,
      },
    ],
  };
}

export function analyzeAuthorityDrift(
  graph: EcosystemGraph,
  authority: AuthorityState | null,
  support: {
    backendProcedureIds?: string[];
    iosCallCount?: number;
  } = {},
): ReviewFinding[] {
  if (!authority) {
    return [];
  }

  const findings: ReviewFinding[] = [];
  const docsRepoId =
    graph.repos.find((repo) => repo.path === authority.docsRepo)?.repoId ?? 'hustlexp-docs';
  const iosRepo = graph.repos.find((repo) => repo.language === 'swift');
  const backendRepo = graph.repos.find(
    (repo) => repo.repoId.includes('backend') || repo.language === 'typescript',
  );
  const phase = authority.currentPhase.toLowerCase();
  const blocked = authority.blockedWorkClasses.join(' | ').toLowerCase();

  if (phase.includes('bootstrap')) {
    if (iosRepo && (iosRepo.apiSurface.exports.length > 25 || support.iosCallCount)) {
      findings.push(
        finding(
          'breaking',
          'Docs phase lags iOS implementation',
          `Authority phase is '${authority.currentPhase}' but the iOS repo already contains advanced navigation, services, or backend integration.`,
          iosRepo.repoId,
          authority.authoritativeApiSurface.sourceFile,
        ),
      );
    }

    if (backendRepo && backendRepo.apiSurface.procedures.length > 0) {
      findings.push(
        finding(
          'breaking',
          'Docs phase lags backend implementation',
          `Authority phase is '${authority.currentPhase}' but the backend repo already exposes routers and procedures.`,
          backendRepo.repoId,
          authority.authoritativeApiSurface.sourceFile,
        ),
      );
    }
  }

  if (blocked.includes('backend calls') && (support.iosCallCount ?? 0) > 0 && iosRepo) {
    findings.push(
      finding(
        'breaking',
        'Bootstrap blocks backend calls but iOS client performs them',
        'CURRENT_PHASE.md blocks backend calls during bootstrap, but Swift tRPC client calls were detected.',
        iosRepo.repoId,
        authority.authoritativeApiSurface.sourceFile,
      ),
    );
  }

  if (
    (blocked.includes('integration work') || blocked.includes('api endpoints')) &&
    (support.backendProcedureIds?.length ?? 0) > 0 &&
    backendRepo
  ) {
    findings.push(
      finding(
        'breaking',
        'Bootstrap blocks backend integration but backend API is active',
        'CURRENT_PHASE.md blocks backend integration work, but authoritative backend procedures were detected.',
        backendRepo.repoId,
        authority.authoritativeApiSurface.sourceFile,
      ),
    );
  }

  const docsProcedures = new Set(authority.authoritativeApiSurface.procedures);
  const backendProcedures = new Set(support.backendProcedureIds ?? []);
  const docsOnly = [...docsProcedures].filter((procedure) => !backendProcedures.has(procedure));
  const backendOnly = [...backendProcedures].filter((procedure) => !docsProcedures.has(procedure));

  if (docsOnly.length > 0) {
    findings.push(
      finding(
        'warning',
        'Docs API contract is ahead of the backend',
        `The docs authority defines ${docsOnly.length} procedure(s) that were not found in the authoritative backend: ${docsOnly.slice(0, 5).join(', ')}${docsOnly.length > 5 ? ', ...' : ''}.`,
        docsRepoId,
        authority.authoritativeApiSurface.sourceFile,
      ),
    );
  }

  if (backendOnly.length > 0 && backendRepo) {
    findings.push(
      finding(
        'warning',
        'Backend API exceeds the docs authority',
        `The backend exposes ${backendOnly.length} procedure(s) not declared in the docs authority: ${backendOnly.slice(0, 5).join(', ')}${backendOnly.length > 5 ? ', ...' : ''}.`,
        backendRepo.repoId,
        authority.authoritativeApiSurface.sourceFile,
      ),
    );
  }

  return findings;
}
