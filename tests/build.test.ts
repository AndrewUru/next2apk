import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildProject, planBuild, generateConfig, type BuildRunner, type ArtifactMetadata } from '../src/index.js';
import { gradleCommand } from '../src/build/gradle.js';
import { validateBuildEnvironment } from '../src/environment/build.js';
import type { DoctorCheck } from '../src/doctor/index.js';
import { snapshot } from '../src/project/files.js';

const app = { appId: 'com.example.test', appName: 'My App', webDir: 'out' };
async function put(root: string, file: string, value: string | Buffer) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), value);
}
async function project(run: (root: string) => Promise<void>, strategy = 'STATIC', manager = 'npm') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'next2apk build '));
  try {
    const config = strategy === 'REMOTE' ? { ...app, webDir: '.next2apk/remote-web', server: { url: 'https://example.com/' } } : app;
    const state = { version: '0.1.0', date: new Date().toISOString(), status: 'completed', step: 'completed', strategy, configuration: config, packageManager: manager, createdFiles: [], modifiedFiles: [], removedFiles: [], backups: [] };
    const files = {
      'package.json': JSON.stringify({ dependencies: { next: '16.x' }, packageManager: `${manager}@1.0.0` }),
      'app/page.jsx': 'export default function Page() {return <main/>}',
      'next.config.mjs': "export default { output: 'export', trailingSlash: true };",
      'capacitor.config.ts': generateConfig(config),
      '.next2apk/state.json': JSON.stringify(state),
      'android/app/build.gradle': 'android { defaultConfig { applicationId "com.example.test" } }',
      'android/app/src/main/AndroidManifest.xml': '<manifest/>',
      'android/variables.gradle': 'ext { compileSdkVersion = 36 }',
      'android/gradlew': '#!/bin/sh\n', 'android/gradlew.bat': '@echo off',
      'android/gradle/wrapper/gradle-wrapper.jar': 'mock-wrapper',
      'android/gradle/wrapper/gradle-wrapper.properties': 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip',
    };
    for (const [file, value] of Object.entries(files)) await put(root, file, value);
    await chmod(path.join(root, 'android/gradlew'), 0o755);
    if (strategy === 'REMOTE') { await put(root, 'app/action.ts', '"use server";'); await put(root, '.next2apk/remote-web/index.html', '<html>remote</html>'); }
    if (strategy === 'HYBRID') await put(root, 'app/backend.ts', 'import {createClient} from "@supabase/supabase-js";');
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const environment = async () => {};
const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('mock APK data ' + Math.random())]);
function runner(calls: string[], fail?: string, artifact: 'valid' | 'missing' | 'empty' | 'multiple' = 'valid'): BuildRunner {
  return async (command, cwd) => {
    const text = `${command.command} ${command.args.join(' ')}`;
    calls.push(text);
    if (fail && text.includes(fail)) throw new Error(`original tool error: ${fail}`);
    if (command.args.includes('next')) await put(cwd, 'out/index.html', '<html>exported</html>');
    if (command.args.includes('assembleDebug') && artifact !== 'missing') {
      await put(cwd, 'app/build/outputs/apk/debug/app-debug.apk', artifact === 'empty' ? '' : zip());
      if (artifact === 'multiple') await put(cwd, 'app/build/outputs/apk/debug/other-debug.apk', zip());
    }
  };
}
test('build without init stops before tools', async () => {
  await project(async root => {
    await rm(path.join(root, '.next2apk/state.json')); const calls: string[] = [];
    await assert.rejects(buildProject(root, {}, { environment, run: runner(calls) }), /not initialized/);
    assert.deepEqual(calls, []);
  });
});
test('malformed and incomplete init state are rejected', async () => {
  await project(async root => {
    for (const state of ['{', '{}', '{"status":"failed"}']) {
      await put(root, '.next2apk/state.json', state);
      await assert.rejects(planBuild(root), /Invalid/);
    }
  });
});
test('missing Capacitor config blocks build', async () => {
  await project(async root => { await rm(path.join(root, 'capacitor.config.ts')); await assert.rejects(planBuild(root), /capacitor.config.ts/); });
});
test('missing Android tree blocks build', async () => {
  await project(async root => { await rm(path.join(root, 'android'), { recursive: true }); await assert.rejects(planBuild(root), /Missing Android/); });
});
for (const manager of ['npm', 'pnpm', 'yarn']) test(`build selects ${manager} for Next and Capacitor`, async () => {
  await project(async root => {
    const calls: string[] = []; await buildProject(root, {}, { environment, run: runner(calls) });
    assert.ok(calls[0]!.startsWith(manager)); assert.ok(calls[1]!.startsWith(manager));
  }, 'STATIC', manager);
});
test('STATIC pipeline publishes APK and metadata after all commands succeed', async () => {
  await project(async root => {
    const calls: string[] = []; const metadata = await buildProject(root, {}, { environment, run: runner(calls) }) as ArtifactMetadata;
    assert.equal(calls.length, 3); assert.match(calls[0]!, /next build/); assert.match(calls[1]!, /cap sync android/); assert.match(calls[2]!, /assembleDebug/);
    assert.equal(metadata.artifact, 'my-app-debug.apk'); assert.ok(metadata.size > 0);
    const file = await readFile(path.join(root, 'dist/android/my-app-debug.apk'));
    assert.equal(file.length, metadata.size);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist/android/build.json'), 'utf8')), metadata);
    assert.equal(metadata.appId, app.appId); assert.equal(metadata.variant, 'debug'); assert.equal(metadata.strategy, 'STATIC'); assert.ok(Date.parse(metadata.createdAt));
  });
});
test('HYBRID builds frontend and explains external infrastructure', async () => {
  await project(async root => {
    const logs: string[] = []; const calls: string[] = [];
    await buildProject(root, {}, { environment, run: runner(calls), log: m => logs.push(m) });
    assert.equal(calls.length, 3); assert.ok(logs.some(m => m.includes('backend is not packaged')));
    await put(root, 'pages/api/private.ts', 'export default function handler() {}');
    await assert.rejects(planBuild(root), /not exportable/);
  }, 'HYBRID');
});
test('REMOTE reuses stored URL and skips Next build', async () => {
  await project(async root => {
    const calls: string[] = [];
    await buildProject(root, {}, { environment, run: runner(calls) });
    assert.equal(calls.length, 2); assert.ok(!calls.some(c => c.includes('next build')));
  }, 'REMOTE');
});
test('REMOTE without URL is refused without a new prompt', async () => {
  await project(async root => {
    const state = JSON.parse(await readFile(path.join(root, '.next2apk/state.json'), 'utf8'));
    delete state.configuration.server; await put(root, '.next2apk/state.json', JSON.stringify(state));
    await assert.rejects(planBuild(root), /requires a configured remote URL/);
  }, 'REMOTE');
});
function goodChecks(): DoctorCheck[] {
  return ['Node', 'npm', 'Java', 'Javac', 'Android SDK', 'next', '@capacitor/core', '@capacitor/cli', '@capacitor/android'].map(name => ({ name, status: 'PASS', detail: name === 'Java' ? 'openjdk version "21.0.1"' : 'available' }));
}
for (const missing of ['Java', 'Android SDK']) test(`missing ${missing} prevents a partial build`, async () => {
  await project(async root => {
    const calls: string[] = [];
    const environment = async () => validateBuildEnvironment(root, 'npm', { inspect: async () => goodChecks().map(c => c.name === missing ? { ...c, status: 'FAIL', detail: 'not found' } : c), sdk: async () => 'mock-sdk' });
    await assert.rejects(buildProject(root, {}, { environment, run: runner(calls) }), new RegExp(missing));
    assert.deepEqual(calls, []); assert.ok(!(await readdir(root)).includes('dist'));
  });
});
test('Windows uses gradlew.bat without requiring global Gradle', () => { assert.equal(gradleCommand('win32').command, 'gradlew.bat'); });
test('Unix uses ./gradlew without requiring global Gradle', () => { assert.equal(gradleCommand('linux').command, './gradlew'); assert.equal(gradleCommand('darwin').command, './gradlew'); });
for (const [failure, step] of [['next build', 'next'], ['cap sync', 'sync'], ['assembleDebug', 'gradle']]) test(`${failure} failure preserves original error and publishes nothing`, async () => {
  await project(async root => {
    const calls: string[] = [];
    await assert.rejects(buildProject(root, {}, { environment, run: runner(calls, failure) }), new RegExp(`step "${step}".*original tool error`));
    assert.ok(!(await readdir(root)).includes('dist'));
  });
});
for (const kind of ['missing', 'empty', 'multiple'] as const) test(`${kind} APK is never published`, async () => {
  await project(async root => {
    await assert.rejects(buildProject(root, {}, { environment, run: runner([], undefined, kind) }), /step "apk-discovery"/);
    assert.ok(!(await readdir(root)).includes('dist'));
  });
});
test('dry-run runs no environment probes or build commands and changes no files', async () => {
  await project(async root => {
    const before = await snapshot(root);
    const fail = async () => { assert.fail('dry-run executed a process'); };
    const plan = await buildProject(root, { dryRun: true, clean: true }, { run: fail, environment: fail });
    assert.ok('operations' in plan); assert.deepEqual(await snapshot(root), before);
    assert.ok(!(await readdir(root)).includes('dist'));
  });
});
test('clean removes only owned APK/metadata and delegates native cleaning to Gradle', async () => {
  await project(async root => {
    await buildProject(root, {}, { environment, run: runner([]) });
    await put(root, 'dist/android/user-notes.txt', 'keep');
    const calls: string[] = [];
    await buildProject(root, { clean: true }, { environment, run: runner(calls) });
    assert.match(calls[2]!, /clean assembleDebug/);
    assert.equal(await readFile(path.join(root, 'dist/android/user-notes.txt'), 'utf8'), 'keep');
  });
});
test('stale APK is not accepted when Gradle produces nothing', async () => {
  await project(async root => {
    await put(root, 'android/app/build/outputs/apk/debug/app-debug.apk', zip());
    await assert.rejects(buildProject(root, {}, { environment, run: runner([], undefined, 'missing') }), /stale APK/);
  });
});
test('a failed rebuild removes the previous owned result rather than advertising stale success', async () => {
  await project(async root => {
    await buildProject(root, {}, { environment, run: runner([]) });
    await assert.rejects(buildProject(root, {}, { environment, run: runner([], 'assembleDebug') }));
    assert.deepEqual(await readdir(path.join(root, 'dist/android')), []);
  });
});
test('unowned destination and tampered owned APK are protected', async () => {
  await project(async root => {
    await put(root, 'dist/android/my-app-debug.apk', 'user artifact');
    await assert.rejects(buildProject(root, { clean: true }, { environment, run: runner([]) }), /not owned/);
    assert.equal(await readFile(path.join(root, 'dist/android/my-app-debug.apk'), 'utf8'), 'user artifact');
    await rm(path.join(root, 'dist/android/my-app-debug.apk'));
    await buildProject(root, {}, { environment, run: runner([]) });
    await put(root, 'dist/android/my-app-debug.apk', 'modified');
    await assert.rejects(buildProject(root, { clean: true }, { environment, run: runner([]) }), /modified outside/);
  });
});
test('config drift and executable Capacitor config block preflight', async () => {
  await project(async root => {
    await put(root, 'capacitor.config.ts', generateConfig({ ...app, appId: 'com.other.app' }));
    await assert.rejects(planBuild(root), /differs/);
    await put(root, 'capacitor.config.ts', 'throw new Error("executed");');
    await assert.rejects(planBuild(root), /executable statements/);
  });
});
test('a commented export setting cannot pass static output validation', async () => {
  await project(async root => {
    await put(root, 'next.config.mjs', "// output: 'export'\nexport default { trailingSlash: true };");
    await assert.rejects(planBuild(root), /no longer matches/);
  });
});
test('Next-generated type scaffolding is restored without changing source files', async () => {
  await project(async root => {
    await put(root, 'tsconfig.json', '{"original":true}'); await put(root, 'next-env.d.ts', '// original');
    const normal = runner([]);
    const run: BuildRunner = async (command, cwd) => {
      if (command.args.includes('next')) { await put(cwd, 'tsconfig.json', '{}'); await put(cwd, 'next-env.d.ts', '// changed'); }
      await normal(command, cwd);
    };
    await buildProject(root, {}, { environment, run });
    assert.equal(await readFile(path.join(root, 'tsconfig.json'), 'utf8'), '{"original":true}');
    assert.equal(await readFile(path.join(root, 'next-env.d.ts'), 'utf8'), '// original');
  });
});
test('.env files in public assets are never synchronized or packaged', async () => {
  await project(async root => {
    await put(root, 'public/.env', 'SECRET=do-not-print'); const calls: string[] = [];
    await assert.rejects(buildProject(root, {}, { environment, run: runner(calls) }), /refusing to package/);
    assert.deepEqual(calls, []);
  });
});
test('incompatible Java and Gradle are diagnosed before compilation', async () => {
  await project(async root => {
    await assert.rejects(validateBuildEnvironment(root, 'npm', { inspect: async () => goodChecks().map(c => c.name === 'Java' ? { ...c, detail: 'openjdk version "25.0.3"' } : c), sdk: async () => 'mock-sdk' }), /not supported/);
  });
});
