// engine/context/cache-manager.ts — SHA-indexed file cache for scan results

import * as fs from 'fs';
import * as path from 'path';
import type { FileScanResult, RepoManifest } from '../types.js';

/**
 * SHA-indexed cache manager for file scan results and repo manifests.
 *
 * Structure on disk:
 *   <cacheDir>/<repo>/files/<sha>.json   — per-file scan results
 *   <cacheDir>/<repo>/manifest-<branch>-<headSha>.json — full repo manifests
 *
 * On scan, check if file SHA matches cached SHA — skip if unchanged.
 */
export class CacheManager {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // ─── File Cache ──────────────────────────────────────────────────────────

  /**
   * Retrieve a cached file scan result.
   * Returns null if no cache entry exists for the given repo/file/sha combination.
   */
  getCachedFile(repo: string, _filePath: string, sha: string): FileScanResult | null {
    const cachePath = this.fileCachePath(repo, sha);

    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      const result: FileScanResult = JSON.parse(raw);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Store a file scan result in the cache, keyed by git blob SHA.
   */
  setCachedFile(repo: string, _filePath: string, sha: string, result: FileScanResult): void {
    const cachePath = this.fileCachePath(repo, sha);
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf-8');
  }

  // ─── Manifest Cache ──────────────────────────────────────────────────────

  /**
   * Retrieve a cached RepoManifest for a given repo and HEAD SHA.
   * Returns null if the manifest is not cached or the headSha doesn't match.
   */
  getCachedManifest(
    repo: string,
    headSha: string,
    branchName: string = 'detached',
  ): RepoManifest | null {
    const cachePath =
      this.findManifestCachePath(repo, headSha, branchName) ??
      this.manifestCachePath(repo, headSha, branchName);

    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      const manifest: RepoManifest = JSON.parse(raw);
      return manifest;
    } catch {
      return null;
    }
  }

  /**
   * Store a RepoManifest in the cache, keyed by HEAD SHA.
   */
  setCachedManifest(
    repo: string,
    headSha: string,
    manifest: RepoManifest,
    branchName: string = 'detached',
  ): void {
    const cachePath = this.manifestCachePath(repo, headSha, branchName);
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  // ─── Invalidation ────────────────────────────────────────────────────────

  /**
   * Remove all cached data for a repo (files + manifests).
   */
  invalidateRepo(repo: string): void {
    const repoDir = this.repoCacheDir(repo);
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  }

  // ─── Pruning ─────────────────────────────────────────────────────────────

  /**
   * Remove all cache entries older than maxAgeDays.
   * Walks every file in the cache directory and removes those whose mtime
   * is older than the cutoff.
   */
  pruneOld(maxAgeDays: number): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    this.pruneDir(this.cacheDir, cutoff);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private repoCacheDir(repo: string): string {
    return path.join(this.cacheDir, this.sanitize(repo));
  }

  private fileCachePath(repo: string, sha: string): string {
    return path.join(this.repoCacheDir(repo), 'files', `${sha}.json`);
  }

  private manifestCachePath(repo: string, headSha: string, branchName: string): string {
    return path.join(
      this.repoCacheDir(repo),
      `manifest-${this.sanitize(branchName)}-${headSha}.json`,
    );
  }

  private findManifestCachePath(repo: string, headSha: string, branchName: string): string | null {
    const directPath = this.manifestCachePath(repo, headSha, branchName);
    if (fs.existsSync(directPath)) {
      return directPath;
    }

    if (branchName !== 'detached') {
      return null;
    }

    const repoDir = this.repoCacheDir(repo);
    if (!fs.existsSync(repoDir)) {
      return null;
    }

    const suffix = `-${headSha}.json`;
    for (const entry of fs.readdirSync(repoDir)) {
      if (entry.startsWith('manifest-') && entry.endsWith(suffix)) {
        return path.join(repoDir, entry);
      }
    }

    return null;
  }

  /**
   * Sanitize a repo name for safe filesystem usage.
   * Replaces path separators and special characters with dashes.
   */
  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  /**
   * Recursively prune files older than cutoff timestamp.
   * Removes empty directories after pruning.
   */
  private pruneDir(dir: string, cutoff: number): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.pruneDir(fullPath, cutoff);
        // Remove empty directories
        try {
          const remaining = fs.readdirSync(fullPath);
          if (remaining.length === 0) {
            fs.rmdirSync(fullPath);
          }
        } catch {
          // Directory may have been removed already
        }
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
        }
      }
    }
  }
}
