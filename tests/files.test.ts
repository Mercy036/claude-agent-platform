import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateProjectPath, AgentRequestSchema } from '../packages/shared/src/protocol';
import { safePath, readProjectFile, parseFileEdits, applyEdits, validateEdits, collectContext, listProjectFiles } from '../apps/cli/src/files';

function fixture(t: test.TestContext) {
  const parent = path.resolve('.test-tmp');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'files-'));
  t.after(() => { assert.equal(path.dirname(directory), parent); fs.rmSync(directory, { recursive: true, force: true }); });
  return directory;
}

test('rejects traversal, Windows special paths and protected configuration', () => {
  for (const value of ['../escape.ts', '/tmp/file', 'C:/file', 'a\\..\\file', 'a/file:stream', 'a/CON.txt', 'a/CONIN$', 'a/COM¹.txt', '.git/config', '.env', 'a/../b', 'a./b', 'a /b', 'node_modules/a', 'a//b', 'a\0b']) {
    assert.throws(() => validateProjectPath(value), /Unsafe project path/, value);
  }
  assert.equal(validateProjectPath('src/main.ts'), 'src/main.ts');
  assert.equal(validateProjectPath('.gitignore'), '.gitignore');
});

test('context schema rejects duplicates and oversized context', () => {
  const file = { path: 'a.ts', content: '', sha256: 'a'.repeat(64) };
  assert.equal(AgentRequestSchema.safeParse({ task: '', files: [] }).success, false);
  assert.equal(AgentRequestSchema.safeParse({ task: 'edit', files: [file, { ...file, path: 'A.ts' }] }).success, false);
  assert.equal(AgentRequestSchema.safeParse({ task: 'edit', files: [{ ...file, content: 'a'.repeat(32769) }] }).success, false);
});

test('rejects a directory junction and file hardlink without touching their targets', t => {
  const directory = fixture(t);
  const project = path.join(directory, 'project');
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(project); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'original');
  fs.symlinkSync(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safePath(project, 'link/secret.txt'), /Links/);
  fs.linkSync(path.join(outside, 'secret.txt'), path.join(project, 'hardlink.txt'));
  assert.throws(() => safePath(project, 'hardlink.txt'), /Links/);
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'original');
});

test('preserves generated whitespace and backs up modified files', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'a.ts'), 'old\n');
  const context = [readProjectFile(root, 'a.ts')];
  const edits = parseFileEdits('Explanation\n<<<FILE: a.ts>>>\n  new\n\n<<<ENDFILE>>>\n<<<FILE: src/b.ts>>>\n b \n<<<ENDFILE>>>');
  const backups = applyEdits(root, edits, context);
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), '  new\n\n');
  assert.equal(fs.readFileSync(path.join(root, 'src/b.ts'), 'utf8'), ' b \n');
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(backups[0], 'utf8'), 'old\n');
});

test('rejects unshared and changed files before applying any edits', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'a.ts'), 'original');
  assert.throws(() => applyEdits(root, [{ path: 'new.ts', content: 'new' }, { path: 'a.ts', content: 'overwrite' }], []), /not shared/);
  assert.equal(fs.existsSync(path.join(root, 'new.ts')), false);
  const context = [readProjectFile(root, 'a.ts')];
  fs.writeFileSync(path.join(root, 'a.ts'), 'local change');
  assert.throws(() => validateEdits(root, [{ path: 'a.ts', content: 'overwrite' }], context), /changed locally/);
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), 'local change');
});

test('malformed, truncated and duplicate generated edits fail closed', () => {
  assert.throws(() => parseFileEdits('<<<FILE: a.ts>>>\nx'), /Incomplete/);
  assert.throws(() => parseFileEdits('<<<FILE: ../a.ts>>>\nx\n<<<ENDFILE>>>'), /Unsafe/);
  assert.throws(() => parseFileEdits('<<<FILE: a.ts>>>\nx\n<<<ENDFILE>>>\n<<<FILE: A.ts>>>\ny\n<<<ENDFILE>>>'), /Duplicate/);
  assert.throws(() => parseFileEdits('<<<FILE: a.ts>>>\nx\n<<<ENDFILE>>>\n<<<FILE: a.ts/b.ts>>>\ny\n<<<ENDFILE>>>'), /Conflicting/);
});

test('file selection omits credentials, binary files and dependencies', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, '.env'), 'secret');
  fs.writeFileSync(path.join(root, 'binary.txt'), Buffer.from([0, 255]));
  fs.writeFileSync(path.join(root, 'a.ts'), 'code');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules/b.ts'), 'dependency');
  assert.deepEqual(listProjectFiles(root), ['a.ts']);
  assert.equal(collectContext(root, ['a.ts'])[0].content, 'code');
});

test('rolls back already replaced files when a later replacement fails', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'a.ts'), 'first');
  fs.writeFileSync(path.join(root, 'b.ts'), 'second');
  const context = ['a.ts', 'b.ts'].map(name => readProjectFile(root, name));
  const rename = fs.renameSync;
  let count = 0;
  t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
    if (++count === 2) throw new Error('Simulated disk failure');
    return rename(...args);
  });
  assert.throws(() => applyEdits(root, [{ path: 'a.ts', content: 'changed' }, { path: 'b.ts', content: 'changed' }], context), /disk failure/);
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), 'first');
  assert.equal(fs.readFileSync(path.join(root, 'b.ts'), 'utf8'), 'second');
  assert.equal(fs.readdirSync(root).some(name => name.includes('hackathon-tmp')), false);
});
