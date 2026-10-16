import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initializeProject, planInit, detectCapacitor, validateAppId, generateConfig, type ProcessRunner, type InitState } from '../src/index.js';
import { selectPackageManager, binaryCommand } from '../src/capacitor/installer.js';
import { prepareNextConfig } from '../src/project/next-config.js';
import { snapshot } from '../src/project/files.js';

const options = { appId: 'com.example.testapp', appName: 'Test App' };
async function project(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'next2apk init '));
  try {
    for (const [file, content] of Object.entries({ 'package.json': JSON.stringify({ dependencies: { next: '16.x' }, packageManager: 'npm@11.12.1' }), 'app/page.tsx': 'export default function Page() {return <main/>}', ...files })) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), content);
    }
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function put(root: string, file: string, content = 'generated') {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), content);
}
function mockRunner(calls: string[], fail?: string, webDir = 'out'): ProcessRunner {
  return async (command, root) => {
    const text = `${command.command} ${command.args.join(' ')}`;
    calls.push(text);
    if (fail && text.includes(fail)) throw new Error(`original external failure: ${text}`);
    if (command.args.includes('@capacitor/core@8.5.3')) {
      const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      pkg.dependencies['@capacitor/core'] = '8.5.3';
      await put(root, 'package.json', JSON.stringify(pkg));
      await put(root, command.command === 'npm' ? 'package-lock.json' : command.command === 'pnpm' ? 'pnpm-lock.yaml' : 'yarn.lock');
    }
    if (text.endsWith('next build')) await put(root, `${webDir}/index.html`, '<html>actual export</html>');
    if (text.endsWith('cap add android')) for (const file of ['app/src/main/AndroidManifest.xml', 'app/build.gradle', 'gradlew', 'gradlew.bat']) await put(root, `android/${file}`);
    if (text.endsWith('cap sync android')) await put(root, 'android/app/src/main/assets/capacitor.config.json', '{}');
  };
}
test('valid Android application IDs', () => {
  for (const id of ['com.example.myapp', 'org.company.app2', 'com.Example.my_app']) assert.doesNotThrow(() => validateAppId(id));
});
test('invalid Android application IDs explain validation', () => {
  for (const id of ['', 'app', 'com..app', '.com.app', 'com.2app', 'com.my-app', 'com.class', 'com.app ', 'com.a;echo']) assert.throws(() => validateAppId(id), /Invalid appId/);
});
test('configuration safely escapes application names', () => {
  assert.throws(() => generateConfig({ ...options, appName: 'My App\n', webDir: 'out' }), /control characters/);
  const code = generateConfig({ ...options, appName: 'My "App"', webDir: 'out' });
  assert.ok(code.includes(JSON.stringify('My "App"')));
});
test('all existing Capacitor config formats are detected and block init', async () => {
  for (const file of ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json']) await project({ [file]: '{}' }, async root => {
    assert.deepEqual(await detectCapacitor(root), [file]);
    assert.ok((await planInit(root, options)).blockers.some(b => b.includes('Existing Capacitor')));
  });
});
test('STATIC config uses detected export folder and preserves unrelated Next settings', async () => {
  await project({ 'next.config.ts': 'const config = {distDir: "mobile", reactStrictMode: true}; export default config;' }, async root => {
    const plan = await planInit(root, options);
    assert.deepEqual(plan.blockers, []); assert.equal(plan.configuration.webDir, 'mobile'); assert.equal(plan.configuration.server, undefined);
    const code = plan.changes.find(c => c.file === 'next.config.ts')!.content;
    assert.match(code, /reactStrictMode: true/); assert.match(code, /output: 'export'/);
  });
});
test('HYBRID browser backend gets static frontend and infrastructure explanation', async () => {
  await project({ 'app/backend.ts': 'import {createClient} from "@supabase/supabase-js";' }, async root => {
    const plan = await planInit(root, options);
    assert.equal(plan.report.strategy, 'HYBRID'); assert.deepEqual(plan.blockers, []); assert.equal(plan.configuration.server, undefined);
    assert.ok(plan.notes.some(n => n.includes('remote infrastructure')));
  });
});
test('HYBRID server routes block conversion and execute nothing', async () => {
  await project({ 'pages/api/hello.ts': 'export default function handler() {}' }, async root => {
    const calls: string[] = [];
    await assert.rejects(initializeProject(root, options, { run: mockRunner(calls) }), /Extract the backend/);
    assert.deepEqual(calls, []); assert.ok(!(await readdir(root)).includes('.next2apk'));
  });
});
test('REMOTE config uses HTTPS server and does not export or modify Next config', async () => {
  await project({ 'app/action.ts': '"use server"; export async function save() {}', 'next.config.mjs': 'export default function config() {return {};}' }, async root => {
    const plan = await planInit(root, { ...options, remoteUrl: 'https://example.com/app' });
    assert.deepEqual(plan.blockers, []); assert.equal(plan.configuration.server?.url, 'https://example.com/app');
    assert.equal(plan.configuration.webDir, '.next2apk/remote-web');
    assert.ok(!plan.changes.some(c => c.file === 'next.config.mjs')); assert.ok(!plan.commands.some(c => c.step === 'assets'));
    const state = await initializeProject(root, { ...options, remoteUrl: 'https://example.com/app' }, { run: mockRunner([]) }) as InitState;
    assert.equal(state.status, 'completed');
  });
});
test('REMOTE requires URL and rejects insecure or credential-bearing URLs', async () => {
  await project({ 'app/action.ts': '"use server";' }, async root => {
    assert.ok((await planInit(root, options)).blockers.some(b => b.includes('requires --remote-url')));
    for (const remoteUrl of ['http://example.com', 'https://user:pass@example.com', 'javascript:alert(1)', 'https://example.com?token=secret']) assert.ok((await planInit(root, { ...options, remoteUrl })).blockers.length);
  });
});
test('dry-run changes zero bytes and starts zero external processes', async () => {
  await project({ 'next.config.js': 'module.exports = {};', '.gitignore': 'custom\n' }, async root => {
    const before = await snapshot(root); const calls: string[] = [];
    const plan = await initializeProject(root, { ...options, dryRun: true }, { run: mockRunner(calls) });
    assert.ok('commands' in plan); assert.deepEqual(calls, []); assert.deepEqual(await snapshot(root), before);
    assert.ok(!(await readdir(root)).includes('.next2apk'));
  });
});
test('init backs up modified files and records state including actual generated artifacts', async () => {
  await project({ 'next.config.mjs': 'export default {};', 'package-lock.json': 'old-lock', '.gitignore': 'custom\n' }, async root => {
    const original = await readFile(path.join(root, 'package.json'), 'utf8');
    const calls: string[] = []; const state = await initializeProject(root, options, { run: mockRunner(calls) }) as InitState;
    assert.equal(state.status, 'completed'); assert.equal(state.version, '0.1.0'); assert.ok(Date.parse(state.date)); assert.equal(state.strategy, 'STATIC');
    assert.deepEqual(state.configuration, { ...options, webDir: 'out' });
    assert.ok(state.createdFiles.includes('android/app/src/main/AndroidManifest.xml'));
    assert.ok(state.modifiedFiles.includes('package.json')); assert.ok(state.modifiedFiles.includes('next.config.mjs'));
    const backup = state.backups.find(b => b.file === 'package.json')!;
    assert.equal(await readFile(path.join(root, backup.backup), 'utf8'), original);
    assert.equal(JSON.parse(await readFile(path.join(root, '.next2apk/state.json'), 'utf8')).status, 'completed');
    assert.match(await readFile(path.join(root, '.gitignore'), 'utf8'), /custom/);
    assert.ok(!(await readdir(path.join(root, '.next2apk'))).includes('init.lock'));
    assert.equal(calls.length, 5); assert.ok(!calls.some(c => c.includes('gradle')));
  });
});
test('--force archives conflicting configs before replacement without losing content', async () => {
  await project({ 'capacitor.config.json': '{"old":true}' }, async root => {
    const state = await initializeProject(root, { ...options, force: true }, { run: mockRunner([]) }) as InitState;
    const backup = state.backups.find(b => b.file === 'capacitor.config.json')!;
    assert.equal(await readFile(path.join(root, backup.backup), 'utf8'), '{"old":true}');
    assert.ok(state.removedFiles.includes('capacitor.config.json'));
    assert.ok((await readdir(root)).includes('capacitor.config.ts'));
  });
});
for (const manager of ['npm', 'pnpm', 'yarn'] as const) test(`selects ${manager} for installation, export and Capacitor`, async () => {
  await project({ 'package.json': JSON.stringify({ dependencies: { next: '16.x' }, packageManager: `${manager}@1.0.0` }) }, async root => {
    const calls: string[] = [];
    const state = await initializeProject(root, options, { run: mockRunner(calls) }) as InitState;
    assert.equal(state.packageManager, manager); assert.ok(calls.every(c => c.startsWith(`${manager} `)));
    assert.equal(binaryCommand(manager, 'cap', ['sync', 'android']).command, manager);
  });
});
test('unknown/conflicting package managers never silently default to npm', () => {
  assert.throws(() => selectPackageManager('unknown'), /Specify/);
  assert.throws(() => selectPackageManager('bun'), /unsupported/);
  assert.throws(() => selectPackageManager('pnpm', 'npm'), /conflicts/);
  assert.equal(selectPackageManager('unknown', 'yarn'), 'yarn');
});
test('failed external process retains original error, step, backups and failed state', async () => {
  for (const fail of ['@capacitor/core', 'next build', 'cap sync']) await project({}, async root => {
    await assert.rejects(initializeProject(root, options, { run: mockRunner([], fail) }), /Init failed at step.*original external failure/);
    const state = JSON.parse(await readFile(path.join(root, '.next2apk/state.json'), 'utf8')) as InitState;
    assert.equal(state.status, 'failed'); assert.match(state.error!, /original external failure/);
    assert.ok(state.backups.some(b => b.file === 'package.json'));
  });
});
test('existing Android project cannot be overwritten even with force', async () => {
  await project({ 'android/custom.txt': 'keep' }, async root => {
    await assert.rejects(initializeProject(root, { ...options, force: true }, { run: mockRunner([]) }), /native customizations/);
    assert.equal(await readFile(path.join(root, 'android/custom.txt'), 'utf8'), 'keep');
  });
});
test('unsafe/dynamic Next configuration is rejected without execution', () => {
  for (const code of ['export default withPlugin({});', 'export default { ...other };', 'export default {distDir:"../outside"};', 'export default {distDir:"src"};', 'throw new Error("executed"); export default {};']) assert.throws(() => prepareNextConfig(code));
});
test('incomplete generated Android tree fails verification rather than claiming success', async () => {
  await project({}, async root => {
    const normal = mockRunner([]);
    const run: ProcessRunner = async (command, cwd) => { if (command.args.includes('cap')) return; await normal(command, cwd); };
    await assert.rejects(initializeProject(root, options, { run }), /step "verify"/);
  });
});
test('backup source is excluded from later analyzer scans', async () => {
  await project({ '.next2apk/backups/old/action.ts': '"use server";' }, async root => {
    assert.equal((await planInit(root, options)).report.strategy, 'STATIC');
  });
});
test('existing state and TypeScript are preserved with explicit backup history', async () => {
  await project({ '.next2apk/state.json': '{"previous":true}', 'package.json': JSON.stringify({ dependencies: { next: '16.x' }, devDependencies: { typescript: '^5.8.0' }, packageManager: 'npm@11.0.0' }) }, async root => {
    const calls: string[] = [];
    const state = await initializeProject(root, options, { run: mockRunner(calls) }) as InitState;
    const previous = state.backups.find(b => b.file === '.next2apk/state.json' && b.backup.includes('/files/'))!;
    assert.equal(await readFile(path.join(root, previous.backup), 'utf8'), '{"previous":true}');
    assert.ok(state.modifiedFiles.includes('.next2apk/state.json'));
    assert.ok(!state.createdFiles.includes('.next2apk/state.json'));
    assert.ok(!calls.some(c => c.includes('typescript@')));
  });
});
test('preexisting lock prevents concurrent initialization without changes', async () => {
  await project({ '.next2apk/init.lock': 'other-process' }, async root => {
    await assert.rejects(initializeProject(root, options, { run: mockRunner([]) }), /init lock exists/);
    assert.equal(await readFile(path.join(root, '.next2apk/init.lock'), 'utf8'), 'other-process');
  });
});

const devInstall = (plan: Awaited<ReturnType<typeof planInit>>) => plan.commands.find(c => c.process.args.includes('-D'))?.process.args ?? [];
const tsFiles = { 'tsconfig.json': '{}' };
test('TypeScript project without React types installs them matching the React major', async () => {
  await project({ ...tsFiles, 'package.json': JSON.stringify({ dependencies: { next: '16.x', react: '^19.1.0' }, packageManager: 'npm@11.12.1' }) }, async root => {
    assert.ok(devInstall(await planInit(root, options)).includes('@types/react@19'));
  });
});
test('declared React types are never reinstalled or replaced', async () => {
  await project({ ...tsFiles, 'package.json': JSON.stringify({ dependencies: { next: '16.x', react: '19.x' }, devDependencies: { '@types/react': '18.3.0' }, packageManager: 'npm@11.12.1' }) }, async root => {
    assert.ok(!devInstall(await planInit(root, options)).some(a => a.startsWith('@types/react')));
  });
});
const reactPackage = JSON.stringify({ dependencies: { next: '16.x', react: '19.x' }, packageManager: 'npm@11.12.1' });
test('JavaScript projects do not get React types', async () => {
  await project({ 'package.json': reactPackage }, async root => {
    await rm(path.join(root, 'app/page.tsx'));
    await put(root, 'app/page.jsx', 'export default function Page() {return null}');
    const plan = await planInit(root, options);
    assert.ok(plan.commands.some(c => c.process.args.includes('-D')), 'dev install still planned');
    assert.ok(!devInstall(plan).some(a => a.startsWith('@types/react')));
  });
});
test('REMOTE strategy runs no Next build and does not get React types', async () => {
  await project({ ...tsFiles, 'package.json': reactPackage, 'middleware.ts': 'export function middleware() {}' }, async root => {
    const plan = await planInit(root, { ...options, remoteUrl: 'https://example.com/app' });
    assert.equal(plan.report.strategy, 'REMOTE');
    assert.ok(!plan.commands.some(c => c.step === 'assets'));
    assert.ok(!devInstall(plan).some(a => a.startsWith('@types/react')));
  });
});
