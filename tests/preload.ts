import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * No test may touch the real ~/.claude-mem. Paths are frozen at first module
 * evaluation, so pin the data directory before any source module loads.
 */
if (!process.env.CLAUDE_MEM_DATA_DIR) {
  process.env.CLAUDE_MEM_DATA_DIR = mkdtempSync(join(tmpdir(), 'claude-mem-test-run-'));
}
