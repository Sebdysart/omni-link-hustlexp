// engine/errors.ts — Structured error types for production-grade error reporting

export type ScanPhase = 'config' | 'git' | 'parse' | 'cache' | 'graph' | 'context';

export class ScanError extends Error {
  constructor(
    message: string,
    public readonly repoId: string,
    public readonly phase: ScanPhase,
    public readonly cause?: Error,
  ) {
    super(`[${repoId}/${phase}] ${message}`);
    this.name = 'ScanError';
  }
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class PathTraversalError extends Error {
  constructor(
    message: string,
    public readonly repoId: string,
    public readonly offendingPath: string,
  ) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

export interface RepoScanFailure {
  repoId: string;
  phase: ScanPhase;
  error: string;
}
