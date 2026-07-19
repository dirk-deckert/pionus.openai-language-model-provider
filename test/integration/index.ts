import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'pionus.codex.manage',
  'pionus.codex.openSettings',
  'pionus.codex.openDebugLogs',
  'pionus.codex.setApiKey',
  'pionus.codex.clearApiKey',
  'pionus.codex.selectAgentProfile',
  'pionus.codex.resetAgentProfile',
  'pionus.codex.showStatus',
  'pionus.codex.showLastUsage',
  'pionus.codex.copyContextSnapshot',
  'pionus.codex.selectSkills',
  'pionus.codex.clearSkills',
  'pionus.codex.runCliExec',
  'pionus.codex.runCliReview'
] as const;

export async function run(): Promise<void> {
  assert.equal(homedir(), process.env.PIONUS_INTEGRATION_ISOLATED_HOME, 'the extension host must not see the developer home directory');
  assert.equal(process.env.OPENAI_API_KEY, undefined, 'the extension host must not receive a real OpenAI key');
  assert.equal(process.env.CODEX_API_KEY, undefined, 'the extension host must not receive a real Codex key');

  const extension = vscode.extensions.getExtension('pionus.openai-language-model-provider');
  assert.ok(extension, 'extension is discoverable');
  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = new Set(await vscode.commands.getCommands(true));
  for (const command of EXPECTED_COMMANDS) {
    assert.equal(commands.has(command), true, `command is registered: ${command}`);
  }
}
