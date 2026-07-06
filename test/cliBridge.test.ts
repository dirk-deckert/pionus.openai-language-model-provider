import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReadOnlyCliCommand, toShellCommand } from '../src/cliBridge.js';
import { baseConfig } from './helpers.js';

test('buildReadOnlyCliCommand builds a conservative codex exec invocation', () => {
  const command = buildReadOnlyCliCommand(baseConfig, {
    prompt: 'inspect current changes',
    cwd: '/tmp/project',
    model: 'gpt-5.5',
    imagePaths: ['/tmp/screenshot one.png'],
    enableSearch: true
  });

  assert.equal(command.executable, 'codex');
  assert.equal(command.mutates, false);
  assert.deepEqual(command.args, [
    '--search',
    'exec',
    '--sandbox', 'read-only',
    '--ask-for-approval', 'never',
    '--cd', '/tmp/project',
    '--model', 'gpt-5.5',
    '--image', '/tmp/screenshot one.png',
    'inspect current changes'
  ]);
});

test('toShellCommand quotes prompts and paths safely', () => {
  const command = buildReadOnlyCliCommand({ ...baseConfig, cliExecutable: '/opt/Codex App/codex' }, {
    prompt: "what's changed?",
    imagePaths: ['/tmp/screenshot one.png']
  });

  assert.equal(toShellCommand(command), "'/opt/Codex App/codex' exec --sandbox read-only --ask-for-approval never --image '/tmp/screenshot one.png' 'what'\\''s changed?'");
});