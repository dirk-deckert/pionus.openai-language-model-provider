import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReviewCliCommand, describeReviewRequest } from '../src/review.js';
import { baseConfig } from './helpers.js';

test('buildReviewCliCommand reviews uncommitted working tree changes', () => {
  const command = buildReviewCliCommand(baseConfig, { mode: 'working-tree' });

  assert.equal(command.executable, 'codex');
  assert.equal(command.mutates, false);
  assert.deepEqual(command.args, ['review', '--uncommitted']);
});

test('buildReviewCliCommand supports base branch, commit, and model override', () => {
  assert.deepEqual(buildReviewCliCommand({ ...baseConfig, reviewModel: 'gpt-5.5' }, {
    mode: 'base',
    target: 'main',
    instructions: 'focus on regressions'
  }).args, ['review', '-c', 'model="gpt-5.5"', '--base', 'main', 'focus on regressions']);

  assert.deepEqual(buildReviewCliCommand(baseConfig, { mode: 'commit', target: 'abc123' }).args, ['review', '--commit', 'abc123']);
});

test('describeReviewRequest names review target', () => {
  assert.equal(describeReviewRequest({ mode: 'base', target: 'main' }), 'base: main');
  assert.equal(describeReviewRequest({ mode: 'working-tree' }), 'working-tree');
});