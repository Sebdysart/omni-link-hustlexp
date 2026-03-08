import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { runLiveProviderGate } from './live-provider-test-gate-lib.mjs';

const result = await runLiveProviderGate({
  env: process.env,
  cwd: process.cwd(),
  execFileSyncImpl: execFileSync,
  spawnSyncImpl: spawnSync,
  fetchImpl: fetch,
  fsImpl: fs,
  tmpdir: os.tmpdir(),
});

console.log(JSON.stringify(result.output));
process.exit(result.code);
