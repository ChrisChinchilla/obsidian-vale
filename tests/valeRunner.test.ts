import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildValeArgs,
  parseValeOutput,
  runValeOnText,
  type ValeProcessRunner
} from '../src/valeRunner.ts';

const issue = {
  Action: { Name: '', Params: [] },
  Check: 'Vale.Terms',
  Description: '',
  Line: 1,
  Link: '',
  Message: 'Use a preferred term.',
  Severity: 'warning',
  Span: [1, 4] as [number, number],
  Match: 'term'
};

test('buildValeArgs associates stdin with the vault-relative note path', () => {
  assert.deepEqual(
    buildValeArgs('/vault/.vale.ini', 'Notes/My note.md'),
    ['--output=JSON', '--config=/vault/.vale.ini', '--path=Notes/My note.md']
  );
  assert.deepEqual(
    buildValeArgs(undefined, 'note.md'),
    ['--output=JSON', '--path=note.md']
  );
});

test('parseValeOutput returns alerts from Vale JSON', () => {
  assert.deepEqual(parseValeOutput(JSON.stringify({ 'Notes/My note.md': [issue] })), [issue]);
  assert.deepEqual(parseValeOutput('{}'), []);
});

test('runValeOnText sends editor content over stdin', async () => {
  let receivedInput = '';
  const runner: ValeProcessRunner = async (_executable, _args, _options, input) => {
    receivedInput = input;
    return {
      stdout: JSON.stringify({ 'draft.md': [issue] }),
      stderr: ''
    };
  };

  const issues = await runValeOnText({
    valePath: 'vale',
    content: 'Unsaved editor content',
    logicalPath: 'draft.md',
    cwd: '/vault'
  }, runner);

  assert.equal(receivedInput, 'Unsaved editor content');
  assert.deepEqual(issues, [issue]);
});

test('runValeOnText accepts Vale exit status 1 when stdout contains alerts', async () => {
  const runner: ValeProcessRunner = async () => {
    throw Object.assign(new Error('Vale found alerts'), {
      stdout: JSON.stringify({ 'draft.md': [issue] })
    });
  };

  assert.deepEqual(await runValeOnText({
    valePath: 'vale',
    content: 'text',
    logicalPath: 'draft.md'
  }, runner), [issue]);
});

test('runValeOnText propagates process failures without JSON output', async () => {
  const runner: ValeProcessRunner = async () => {
    throw new Error('Vale could not start');
  };

  await assert.rejects(
    runValeOnText({ valePath: 'vale', content: 'text', logicalPath: 'draft.md' }, runner),
    /could not start/
  );
});
