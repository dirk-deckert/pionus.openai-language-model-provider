import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

const extensionDevelopmentPath = resolve(import.meta.dirname, '..');
const extensionTestsPath = resolve(extensionDevelopmentPath, 'out-test', 'test', 'integration', 'index.js');
const isolatedHome = await mkdtemp(join(tmpdir(), 'pv-'));
const userDataDir = join(isolatedHome, 'u');
const extensionsDir = join(isolatedHome, 'e');

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    launchArgs: [
      '--disable-extensions',
      '--disable-workspace-trust',
      '--user-data-dir', userDataDir,
      '--extensions-dir', extensionsDir
    ],
    extensionTestsEnv: {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      PIONUS_INTEGRATION_ISOLATED_HOME: isolatedHome,
      OPENAI_API_KEY: undefined,
      CODEX_API_KEY: undefined,
      AZURE_OPENAI_API_KEY: undefined
    }
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(isolatedHome, { recursive: true, force: true });
}
