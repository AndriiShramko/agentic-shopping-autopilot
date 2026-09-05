import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// In-process tests never touch the developer's live runtime/.state: the state directory is a scratch folder.
const scratchState = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-vitest-state-'));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { ASA_STATE_DIR: scratchState },
  },
});
