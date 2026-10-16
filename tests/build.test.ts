import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildProject, planBuild, generateConfig, type BuildRunner, type ArtifactMetadata } from '../src/index.js';
import { gradleCommand, runGradle } from '../src/build/gradle.js';
import { validateBuildEnvironment } from '../src/environment/build.js';
import type { DoctorCheck } from '../src/doctor/index.js';
import { snapshot } from '../src/project/files.js';
import { isJdkSupported, parseGradleVersion, parseJavaMajor, findCompatibleJdk, androidStudioJdkLocations } from '../src/environment/jdk.js';
import { validateSdk, findAndroidSdk, defaultSdkLocations } from '../src/environment/sdk.js';
import { spawnSync } from 'node:child_process';

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
    const environment = async () => validateBuildEnvironment(root, 'npm', { inspect: async () => goodChecks().map(c => c.name === missing ? { ...c, status: 'FAIL', detail: 'not found' } : c), sdk: async () => 'mock-sdk', env: {}, sdkDefaults: [], findJdk: async () => undefined });
    await assert.rejects(buildProject(root, {}, { environment, run: runner(calls) }), new RegExp(missing));
    assert.deepEqual(calls, []); assert.ok(!(await readdir(root)).includes('dist'));
  });
});
test('Windows uses gradlew.bat without requiring global Gradle', () => { assert.equal(gradleCommand('win32').command, 'gradlew.bat'); });
test('Windows runs the wrapper even when cmd.exe skips the current directory', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gradle-'));
  const previous = process.env.NoDefaultCurrentDirectoryInExePath;
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
  try {
    await writeFile(path.join(dir, 'gradlew.bat'), '@echo off\r\nexit /b 0');
    await runGradle(gradleCommand('win32'), dir);
  } finally {
    if (previous === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath; else process.env.NoDefaultCurrentDirectoryInExePath = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
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
    await assert.rejects(validateBuildEnvironment(root, 'npm', { inspect: async () => goodChecks().map(c => c.name === 'Java' ? { ...c, detail: 'openjdk version "25.0.3"' } : c), sdk: async () => 'mock-sdk', env: {}, sdkDefaults: [], findJdk: async () => undefined }), /not supported/);
  });
});
const java25 = (c: DoctorCheck) => c.name === 'Java' ? { ...c, detail: 'openjdk version "25.0.3"' } : c;
const sdkOnly = { sdk: async () => 'mock-sdk' };
test('JDK on PATH that Gradle cannot use falls back to a compatible Android Studio JDK', async () => {
  await project(async root => {
    const result = await validateBuildEnvironment(root, 'npm', { inspect: async () => goodChecks().map(java25), ...sdkOnly, env: {}, sdkDefaults: [], findJdk: async () => '/studio/jbr' });
    assert.equal(result.javaHome, '/studio/jbr');
    assert.match(result.notes.join('\n'), /Android Studio JDK at \/studio\/jbr.*\(25\)/);
  });
});
test('a usable JDK on PATH is never replaced', async () => {
  await project(async root => {
    const result = await validateBuildEnvironment(root, 'npm', { inspect: async () => goodChecks(), ...sdkOnly, env: {}, sdkDefaults: [], findJdk: async () => assert.fail('must not search for another JDK') });
    assert.equal(result.javaHome, undefined);
    assert.deepEqual(result.notes, []);
  });
});
test('an explicit JAVA_HOME is respected even when it is unusable', async () => {
  await project(async root => {
    await assert.rejects(validateBuildEnvironment(root, 'npm', { inspect: async () => goodChecks().map(java25), ...sdkOnly, env: { JAVA_HOME: '/chosen' }, sdkDefaults: [], findJdk: async () => assert.fail('must not override JAVA_HOME') }), /not supported/);
  });
});
test('missing java on PATH can still build with a discovered JDK', async () => {
  await project(async root => {
    const inspect = async () => goodChecks().map(c => c.name === 'Java' || c.name === 'Javac' ? { ...c, status: 'FAIL' as const, detail: 'not found' } : c);
    assert.equal((await validateBuildEnvironment(root, 'npm', { inspect, ...sdkOnly, env: {}, sdkDefaults: [], findJdk: async () => '/studio/jbr' })).javaHome, '/studio/jbr');
  });
});
test('the substitute JDK reaches only the Gradle step', async () => {
  await project(async root => {
    const seen: [string, string | undefined][] = [];
    const run: BuildRunner = async (command, cwd, env) => { seen.push([command.args.join(' '), env?.JAVA_HOME]); await runner([])(command, cwd, env); };
    await buildProject(root, {}, { environment: async () => ({ javaHome: '/studio/jbr', notes: ['note'] }), run });
    const gradle = seen.find(([args]) => args.includes('assembleDebug'));
    assert.equal(gradle?.[1], '/studio/jbr');
    assert.ok(seen.filter(([args]) => !args.includes('assembleDebug')).every(([, home]) => home === undefined));
  });
});
test('an SDK found only in its default location is handed to Gradle; a configured one is left alone', async () => {
  await project(async root => {
    await put(root, 'default-sdk/platforms/android-36/android.jar', 'mock');
    const deps = { inspect: async () => goodChecks(), sdk: async () => 'mock-sdk', findJdk: async () => undefined, sdkDefaults: [path.join(root, 'default-sdk')] };
    const found = await validateBuildEnvironment(root, 'npm', { ...deps, env: {} });
    assert.equal(found.androidHome, path.join(root, 'default-sdk'));
    assert.match(found.notes.join('\n'), /Android SDK at .*default-sdk/);
    assert.equal((await validateBuildEnvironment(root, 'npm', { ...deps, env: { ANDROID_HOME: '/mine' } })).androidHome, undefined);
  });
});
test('Gradle receives ANDROID_HOME only when next2apk discovered the SDK', async () => {
  await project(async root => {
    const seen: [string, string | undefined][] = [];
    const run: BuildRunner = async (command, cwd, env) => { seen.push([command.args.join(' '), env?.ANDROID_HOME]); await runner([])(command, cwd, env); };
    await buildProject(root, {}, { environment: async () => ({ androidHome: '/sdk', notes: [] }), run });
    assert.equal(seen.find(([args]) => args.includes('assembleDebug'))?.[1], '/sdk');
    assert.ok(seen.filter(([args]) => !args.includes('assembleDebug')).every(([, home]) => home === undefined));
  });
});
test('JDK compatibility follows the Gradle wrapper version', () => {
  assert.deepEqual(parseGradleVersion('distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip'), [8, 14]);
  assert.equal(parseJavaMajor('openjdk version "21.0.10" 2026-01-20'), 21);
  assert.equal(isJdkSupported(21, [8, 14]), true);
  assert.equal(isJdkSupported(25, [8, 14]), false);
  assert.equal(isJdkSupported(25, [9, 1]), true);
  assert.equal(isJdkSupported(17, [8, 14]), false);
  assert.equal(isJdkSupported(undefined, [8, 14]), false);
  assert.equal(isJdkSupported(21, undefined), false);
});
test('JDK discovery skips incompatible candidates and finds nothing when none qualifies', async () => {
  const majors: Record<string, number> = { '/a': 17, '/b': 25, '/c': 21 };
  const probe = async (home: string) => majors[home];
  assert.equal(await findCompatibleJdk([8, 14], ['/a', '/b', '/c'], probe), '/c');
  assert.equal(await findCompatibleJdk([8, 14], ['/a', '/b'], probe), undefined);
  assert.ok(androidStudioJdkLocations({ ProgramFiles: 'C:\\Program Files' }, 'win32', 'C:\\Users\\a')[0]?.endsWith('Android Studio\\jbr'));
});
test('SDK validation checks the required platform and build tools via local.properties', async () => {
  await project(async root => {
    await put(root, 'android/local.properties', 'sdk.dir=../fake-sdk');
    await assert.rejects(validateSdk(root), /android-36 is missing/);
    await put(root, 'fake-sdk/platforms/android-36/android.jar', 'mock');
    await assert.rejects(validateSdk(root), /build-tools 35.0.0/);
    await put(root, `fake-sdk/build-tools/35.0.0/${process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'}`, 'mock');
    assert.equal(await validateSdk(root), path.join(root, 'fake-sdk'));
  });
});
test('SDK falls back to Android Studio default locations only when nothing is configured', async () => {
  await project(async root => {
    await put(root, 'default-sdk/platforms/android-36/android.jar', 'mock');
    const defaults = [path.join(root, 'missing-sdk'), path.join(root, 'default-sdk')];
    assert.equal(await findAndroidSdk(root, {}, defaults), path.join(root, 'default-sdk'));
    assert.equal(await findAndroidSdk(root, { ANDROID_HOME: 'explicit' }, defaults), 'explicit');
    assert.equal(await findAndroidSdk(root, {}, [path.join(root, 'missing-sdk')]), undefined);
  });
});
test('default SDK locations follow each platform convention', () => {
  assert.deepEqual(defaultSdkLocations({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a'), ['C:\\Users\\a\\AppData\\Local\\Android\\Sdk']);
  assert.deepEqual(defaultSdkLocations({}, 'win32', 'C:\\Users\\a'), ['C:\\Users\\a\\AppData\\Local\\Android\\Sdk']);
  assert.deepEqual(defaultSdkLocations({}, 'darwin', '/Users/a'), ['/Users/a/Library/Android/sdk']);
  assert.ok(defaultSdkLocations({}, 'linux', '/home/a').includes('/home/a/Android/Sdk'));
});
test('missing build-tools error says exactly what to install', async () => {
  await project(async root => {
    await put(root, 'android/local.properties', 'sdk.dir=../fake-sdk');
    await put(root, 'fake-sdk/platforms/android-36/android.jar', 'mock');
    await put(root, `fake-sdk/build-tools/36.0.0/${process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'}`, 'mock');
    await assert.rejects(validateSdk(root), /sdkmanager "build-tools;35.0.0"/);
  });
});
test('CLI build dry-run prints the pipeline without creating artifacts', async () => {
  await project(async root => {
    const before = await snapshot(root);
    const cli = path.resolve('src/cli/index.ts');
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, 'build', root, '--dry-run', '--clean'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /clean assembleDebug/); assert.match(result.stdout, /No files were modified/);
    assert.deepEqual(await snapshot(root), before);
  });
});
