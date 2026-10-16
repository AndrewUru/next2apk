import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cli = path.resolve('src/cli/index.ts');
const fixture = path.resolve('fixtures/static-next');
function run(args: string[], cwd = process.cwd()) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
}
test('CLI defaults to cwd and produces a JSON contract', () => {
  const result = run(['analyze', '--json'], fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).root, fixture);
  assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
  assert.match(run([], fixture).stdout, /Recommended strategy:\nSTATIC/);
});
test('CLI returns nonzero for blockers and invalid arguments', () => {
  assert.equal(run(['analyze', 'fixtures/server-actions-next']).status, 1);
  assert.equal(run(['unknown-command']).status, 1);
  assert.equal(run(['analyze', '--unknown']).status, 1);
});
test('build without init does not claim successful conversion', () => {
  for (const command of ['build']) {
    const result = run([command, fixture]);
    assert.equal(result.status, 1); assert.match(result.stderr, /not initialized/); assert.equal(result.stdout, '');
  }
});
test('init dry-run prints strategy and concrete operations without executing them', () => {
  const result = run(['init', fixture, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Strategy: STATIC/);
  assert.match(result.stdout, /create capacitor.config.ts/);
  assert.match(result.stdout, /npm install @capacitor\/core@8.5.3/);
  assert.match(result.stdout, /No files were modified/);
});
test('noninteractive init requests missing application ID before mutation', () => {
  const result = run(['init', fixture]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /appId is required/);
  const missing = run(['init', 'fixtures/nonexistent-project']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /step "analyze\/plan"/);
});
