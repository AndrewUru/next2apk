import { readFile, writeFile, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { runProcess, type ProcessCommand } from '../capacitor/installer.js';
import { validateBuildEnvironment, type BuildEnvironment } from '../environment/build.js';
import { assertSafePath, exists } from '../project/files.js';
import { planBuild, type BuildOptions, type BuildPlan } from './pipeline.js';
import { runGradle, type BuildRunner } from './gradle.js';
import { apkSnapshot, discoverApk, publishApk, ownedArtifact, clearPublishedArtifact, validateWebOutput, rejectEnvFiles, type ArtifactMetadata } from './artifacts.js';

export interface BuildDependencies {
  run?: BuildRunner;
  environment?: (...args: Parameters<typeof validateBuildEnvironment>) => Promise<BuildEnvironment | void>;
  log?: (message: string) => void;
  platform?: NodeJS.Platform;
}
export class BuildError extends Error {
  constructor(public readonly step: string, cause: unknown) { super(`Build failed at step "${step}": ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
}
const defaultRunner: BuildRunner = (command, cwd, env) => ['gradlew.bat', './gradlew'].includes(command.command) ? runGradle(command, cwd, env) : runProcess(command as ProcessCommand, cwd);

async function runNextPreservingTypeFiles(run: () => Promise<void>, root: string): Promise<void> {
  // Next may rewrite these during its type check. Preserve the developer's original bytes.
  const originals = new Map<string, Buffer | undefined>();
  for (const file of ['tsconfig.json', 'next-env.d.ts']) {
    await assertSafePath(root, file);
    originals.set(file, await exists(path.join(root, file)) ? await readFile(path.join(root, file)) : undefined);
  }
  try { await run(); }
  finally {
    for (const [file, original] of originals) {
      await assertSafePath(root, file);
      const full = path.join(root, file);
      if (original === undefined) { if (await exists(full)) await unlink(full); }
      else if (!await exists(full) || !(await readFile(full)).equals(original)) await writeFile(full, original);
    }
  }
}
export async function buildProject(input = process.cwd(), options: BuildOptions = {}, deps: BuildDependencies = {}): Promise<BuildPlan | ArtifactMetadata> {
  let step = 'preflight';
  let lock: string | undefined;
  const log = deps.log ?? (() => {});
  const run = deps.run ?? defaultRunner;
  try {
    const plan = await planBuild(input, options, deps.platform);
    await ownedArtifact(plan);
    if (options.dryRun) return plan;
    log('✓ Project analyzed\n✓ next2apk configuration found');
    log(`Project: ${plan.configuration.appName}\nStrategy: ${plan.report.strategy}`);
    if (plan.report.strategy !== 'STATIC') log('This APK requires external infrastructure. The backend is not packaged in Android.');
    step = 'environment';
    const environment = await (deps.environment ?? validateBuildEnvironment)(plan.root, plan.manager) || undefined;
    for (const note of environment?.notes ?? []) log(note);
    // Only Gradle needs the discovered JDK/SDK; JAVA_HOME takes priority in the Gradle wrapper.
    const gradleEnv = environment?.javaHome || environment?.androidHome
      ? { ...process.env, ...(environment.javaHome ? { JAVA_HOME: environment.javaHome } : {}), ...(environment.androidHome ? { ANDROID_HOME: environment.androidHome } : {}) }
      : undefined;
    log('✓ Environment validated');
    // REMOTE shell must exist before any mutations; local web assets are regenerated below.
    if (plan.report.strategy === 'REMOTE') await validateWebOutput(plan.root, plan.configuration.webDir);
    await rejectEnvFiles(plan.root, 'android/app/src');
    await rejectEnvFiles(plan.root, 'public');
    step = 'lock';
    const lockPath = path.join(plan.root, '.next2apk/init.lock');
    const handle = await open(lockPath, 'wx');
    lock = lockPath;
    await handle.close();
    step = 'artifacts';
    // Invalidate only verified owned results before a new attempt; failed attempts cannot advertise old APKs.
    await clearPublishedArtifact(plan);
    const before = await apkSnapshot(plan.root);
    for (const operation of plan.operations) {
      step = operation.step;
      log(`Running ${operation.command.command} ${operation.command.args.join(' ')}...`);
      if (step === 'next') {
        await runNextPreservingTypeFiles(() => run(operation.command, operation.cwd), plan.root);
        step = 'web-output';
        await validateWebOutput(plan.root, plan.configuration.webDir);
        log('✓ Next.js build completed');
      } else {
        if (step === 'sync') await validateWebOutput(plan.root, plan.configuration.webDir);
        await run(operation.command, operation.cwd, step === 'gradle' ? gradleEnv : undefined);
        if (step === 'sync') { await rejectEnvFiles(plan.root, 'android/app/src/main/assets'); log('✓ Capacitor synchronized'); }
      }
    }
    step = 'apk-discovery';
    const apk = await discoverApk(plan.root, before);
    step = 'publish';
    const result = await publishApk(plan, apk);
    log('✓ Android build completed');
    return result;
  } catch (error) { throw new BuildError(step, error); }
  finally { if (lock) await unlink(lock); }
}
