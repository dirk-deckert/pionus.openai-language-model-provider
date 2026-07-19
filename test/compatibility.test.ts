import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { MANAGEMENT_ACTIONS } from '../src/managementActions.js';

const EXISTING_COMMANDS = [
  ['pionus.codex.manage', 'Pionus OpenAI Language Model Provider: Manage'],
  ['pionus.codex.openSettings', 'Pionus OpenAI Language Model Provider: Open Settings'],
  ['pionus.codex.openDebugLogs', 'Pionus OpenAI Language Model Provider: Open Debug Logs'],
  ['pionus.codex.setApiKey', 'Pionus OpenAI Language Model Provider: Set API Key'],
  ['pionus.codex.clearApiKey', 'Pionus OpenAI Language Model Provider: Clear API Key'],
  ['pionus.codex.selectAgentProfile', 'Pionus OpenAI Language Model Provider: Select Agent Profile'],
  ['pionus.codex.resetAgentProfile', 'Pionus OpenAI Language Model Provider: Reset Agent Profile'],
  ['pionus.codex.showStatus', 'Pionus OpenAI Language Model Provider: Show Status'],
  ['pionus.codex.showLastUsage', 'Pionus OpenAI Language Model Provider: Show Last Usage'],
  ['pionus.codex.copyContextSnapshot', 'Pionus OpenAI Language Model Provider: Copy IDE Context Snapshot'],
  ['pionus.codex.selectSkills', 'Pionus OpenAI Language Model Provider: Select Skills'],
  ['pionus.codex.clearSkills', 'Pionus OpenAI Language Model Provider: Clear Skills'],
  ['pionus.codex.runCliExec', 'Pionus OpenAI Language Model Provider: Run Codex CLI Exec'],
  ['pionus.codex.runCliReview', 'Pionus OpenAI Language Model Provider: Run Codex CLI Review']
] as const;

const EXISTING_SETTING_DEFAULTS: Readonly<Record<string, unknown>> = {
  'pionus.codex.activeAgentProfile': null,
  'pionus.codex.agentProfilePaths': [],
  'pionus.codex.baseURL': 'https://chatgpt.com/backend-api/codex/responses',
  'pionus.codex.cliExecutable': null,
  'pionus.codex.clientVersion': '0.0.0',
  'pionus.codex.credentialsSource': 'auto',
  'pionus.codex.defaultExecutionProfile': 'codex-execute',
  'pionus.codex.defaultPlanningProfile': 'codex-plan',
  'pionus.codex.defaultReasoningEffort': 'auto',
  'pionus.codex.enableAgentProfiles': true,
  'pionus.codex.enableCliBridge': false,
  'pionus.codex.enableImageInput': true,
  'pionus.codex.enableSkillInjection': true,
  'pionus.codex.ideContextMaxSelectionBytes': 12_000,
  'pionus.codex.includeCodexInstructions': true,
  'pionus.codex.includeIdeContext': true,
  'pionus.codex.instructions': 'You are a helpful coding assistant integrated with VS Code.',
  'pionus.codex.maxOutputTokens': 8_192,
  'pionus.codex.mirrorCodexConfiguredAgents': true,
  'pionus.codex.model': 'gpt-5.6-sol',
  'pionus.codex.modelPricingUsdPerMTok': {},
  'pionus.codex.projectDocFallbackFilenames': [],
  'pionus.codex.projectDocMaxBytes': 32_768,
  'pionus.codex.reviewModel': null,
  'pionus.codex.showUsageInStatusBar': true,
  'pionus.codex.skillPaths': []
};

const EXISTING_SETTING_SCOPES: Readonly<Record<string, string | undefined>> = {
  ...Object.fromEntries(Object.keys(EXISTING_SETTING_DEFAULTS).map((setting) => [setting, undefined])),
  'pionus.codex.baseURL': 'application',
  'pionus.codex.credentialsSource': 'application',
  'pionus.codex.enableCliBridge': 'application',
  'pionus.codex.cliExecutable': 'machine'
};

interface ManifestSetting {
  default?: unknown;
  scope?: string;
}

test('manifest preserves stable IDs in the 0.1.3 release', async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as Record<string, any>;

  assert.equal(`${manifest.publisher}.${manifest.name}`, 'pionus.openai-language-model-provider');
  assert.equal(manifest.name, 'openai-language-model-provider');
  assert.equal(manifest.displayName, 'Pionus OpenAI Language Model Provider');
  assert.equal(manifest.publisher, 'pionus');
  assert.equal(manifest.version, '0.1.3');
  assert.equal(manifest.main, './dist/extension.js');
  assert.equal(manifest.engines.vscode, '^1.104.0');

  assert.deepEqual(manifest.activationEvents, [
    'onLanguageModelChatProvider:pionus-codex',
    'onStartupFinished'
  ]);
  assert.deepEqual(manifest.contributes.languageModelChatProviders, [{
    vendor: 'pionus-codex',
    displayName: 'Pionus OpenAI Language Model Provider',
    managementCommand: 'pionus.codex.manage'
  }]);

  const commands = (manifest.contributes.commands as Array<{ command: string; title: string }>)
    .map(({ command, title }) => [command, title]);
  assert.equal(commands.length, 14, 'the extension must expose exactly the existing 14 commands');
  assert.deepEqual(commands, EXISTING_COMMANDS);

  assert.equal(manifest.contributes.configuration.title, 'Pionus OpenAI Language Model Provider');
  const properties = manifest.contributes.configuration.properties as Record<string, ManifestSetting>;
  assert.equal(Object.keys(properties).length, 26, 'the extension must expose exactly the existing 26 settings');
  assert.deepEqual(Object.keys(properties).sort(), Object.keys(EXISTING_SETTING_DEFAULTS).sort());
  assert.deepEqual(
    Object.fromEntries(Object.entries(properties).map(([setting, schema]) => [setting, schema.default])),
    EXISTING_SETTING_DEFAULTS
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(properties).map(([setting, schema]) => [setting, schema.scope])),
    EXISTING_SETTING_SCOPES
  );
});

test('management menu dispatches every contributed utility command exactly once', () => {
  const expected = EXISTING_COMMANDS
    .map(([command]) => command)
    .filter((command) => command !== 'pionus.codex.manage')
    .sort();
  const actual = MANAGEMENT_ACTIONS.map((action) => action.command).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(MANAGEMENT_ACTIONS.map((action) => action.label)).size, MANAGEMENT_ACTIONS.length);
});
