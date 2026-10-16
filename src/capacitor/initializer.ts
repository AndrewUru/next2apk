import { mkdir, readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { analyzeProject } from '../analyzer/index.js';
import type { AnalysisReport } from '../analyzer/types.js';
import { generateConfig, validateRemoteUrl, type AppConfiguration } from './config.js';
import { binaryCommand, installCommands, runProcess, selectPackageManager, type PackageManager, type ProcessCommand, type ProcessRunner } from './installer.js';
import { assertSafePath, exists, snapshot, type Snapshot } from '../project/files.js';
import { prepareNextConfig } from '../project/next-config.js';
import { BackupJournal, type InitState } from '../backup/journal.js';

export interface InitOptions {
  appName?: string;
  appId?: string;
  remoteUrl?: string;
  packageManager?: string;
  force?: boolean;
  dryRun?: boolean;
}
export interface FileChange { file: string; content: string; kind: 'create' | 'modify' }
export interface InitPlan {
  report: AnalysisReport;
  configuration: AppConfiguration;
  packageManager?: PackageManager;
  changes: FileChange[];
  archivedConfigs: string[];
  commands: { step: string; process: ProcessCommand }[];
  blockers: string[];
  notes: string[];
  baseline: Snapshot;
}
const capacitorConfigs = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json', 'capacitor.config.mjs', 'capacitor.config.cjs'];
export async function detectCapacitor(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of capacitorConfigs) if (await exists(path.join(root, file))) found.push(file);
  return found;
}
export async function planInit(input = process.cwd(), options: InitOptions = {}): Promise<InitPlan> {
  const report = await analyzeProject(input);
  const root = report.root;
  const blockers: string[] = [];
  const notes = report.issues.map(i => `${i.code}: ${i.message}${i.file ? ` (${i.file})` : ''}`);
  const changes: FileChange[] = [];
  const commands: InitPlan['commands'] = [];
  const packageJson = await exists(path.join(root, 'package.json')) ? await readFile(path.join(root, 'package.json'), 'utf8') : '{}';
  let needsTypescript = true;
  let reactTypes: string | undefined;
  try {
    const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; workspaces?: unknown };
    needsTypescript = !(pkg.dependencies?.typescript || pkg.devDependencies?.typescript);
    // Next.js installs missing React types itself only outside CI, and only when a person can be prompted. Declare them for reproducible builds.
    const react = pkg.dependencies?.react ?? pkg.devDependencies?.react;
    if (report.typescript && report.strategy !== 'REMOTE' && react && !(pkg.dependencies?.['@types/react'] || pkg.devDependencies?.['@types/react'])) {
      const major = react.match(/\d+/)?.[0];
      reactTypes = major ? `@types/react@${major}` : '@types/react';
    }
    if (pkg.workspaces) blockers.push('Workspace root detected. Initialize an isolated application package; workspace installs are not supported yet.');
  } catch { /* Analyzer reports invalid package JSON. */ }
  const capture = async (fn: () => void | Promise<void>): Promise<void> => {
    try { await fn(); } catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); }
  };
  let baseline: Snapshot = {};
  await capture(async () => { baseline = await snapshot(root); });
  for (const file of ['.next2apk', '.next2apk/backups', '.next2apk/state.json', '.next2apk/init.lock']) await capture(() => assertSafePath(root, file));
  if (await exists(path.join(root, '.next2apk/init.lock'))) blockers.push('An init lock exists. Check that no init is running before removing .next2apk/init.lock.');
  if (Number(process.versions.node.split('.')[0]) < 22) blockers.push('Capacitor 8 requires Node >=22.');
  const invalid = new Set(['PACKAGE_MISSING', 'PACKAGE_INVALID', 'NEXT_MISSING', 'PACKAGE_MANAGER_CONFLICT', 'ROUTER_UNKNOWN', 'SOURCE_PARSE_REVIEW', 'SYMLINK_SKIPPED']);
  for (const issue of report.issues) {
    if (invalid.has(issue.code) || (report.strategy !== 'REMOTE' && issue.severity === 'error')) blockers.push(`${issue.code}: ${issue.message}`);
  }
  if (report.strategy === 'HYBRID' && report.compatibility === 'FAIL') blockers.push('HYBRID with server routes cannot be exported as-is. Extract the backend and update the client before init.');
  const existing = await detectCapacitor(root);
  if (existing.length && !options.force) blockers.push(`Existing Capacitor configuration: ${existing.join(', ')}. Use --force to archive it with a backup before replacement.`);
  if (await exists(path.join(root, 'android'))) blockers.push('android/ already exists. init will not overwrite native customizations, even with --force. Use the existing Capacitor workflow.');
  let packageManager: PackageManager | undefined;
  await capture(() => { packageManager = selectPackageManager(report.packageManager, options.packageManager); });
  const configuration: AppConfiguration = { appName: options.appName ?? path.basename(root), appId: options.appId ?? 'com.example.app', webDir: 'out' };
  if (!options.appId) {
    if (options.dryRun) notes.push('Preview appId com.example.app is an example; actual init requires --app-id or an interactive answer.');
    else blockers.push('appId is required. Provide --app-id com.example.myapp or use an interactive terminal.');
  }
  if (report.strategy === 'REMOTE') {
    configuration.webDir = '.next2apk/remote-web';
    if (!options.remoteUrl) blockers.push('REMOTE requires --remote-url https://your-deployed-next-app.example or an interactive answer.');
    else await capture(() => { configuration.server = { url: validateRemoteUrl(options.remoteUrl!) }; });
    notes.push('REMOTE loads the deployed website. Hosting, authentication and server functions must remain online; no Next.js assets are exported. Capacitor server.url is intended primarily for live reload: validate remote navigation and native plugin security before distributing.');
    changes.push({ file: '.next2apk/remote-web/index.html', kind: await exists(path.join(root, '.next2apk/remote-web/index.html')) ? 'modify' : 'create', content: '<!doctype html><html><head><meta charset="utf-8"><title>Remote application</title></head><body>This application requires its configured remote server and an internet connection.</body></html>\n' });
  } else {
    if (options.remoteUrl) blockers.push('--remote-url is only valid for a REMOTE analysis. HYBRID backend extraction is not automatic.');
    if (report.configFiles.length > 1) blockers.push('Multiple Next config files found; resolve the ambiguity before init.');
    const file = report.configFiles[0] ?? 'next.config.mjs';
    await capture(async () => {
      const previous = await exists(path.join(root, file)) ? await readFile(path.join(root, file), 'utf8') : undefined;
      const edit = prepareNextConfig(previous, file, report.issues.some(i => i.code === 'IMAGE_OPTIMIZATION_REVIEW'));
      configuration.webDir = edit.webDir;
      await assertSafePath(root, edit.webDir);
      if (previous !== edit.content) changes.push({ file, content: edit.content, kind: previous === undefined ? 'create' : 'modify' });
    });
    if (report.strategy === 'HYBRID') notes.push('HYBRID exports only the frontend. Supabase/external backend, authentication redirects, CORS and public client keys still need remote infrastructure and review.');
  }
  await capture(() => { changes.push({ file: 'capacitor.config.ts', content: generateConfig(configuration), kind: existing.includes('capacitor.config.ts') ? 'modify' : 'create' }); });
  await capture(async () => {
    await assertSafePath(root, '.gitignore');
    const previous = await exists(path.join(root, '.gitignore')) ? await readFile(path.join(root, '.gitignore'), 'utf8') : undefined;
    if (!previous?.split(/\r?\n/).some(line => ['.next2apk/', '/.next2apk/'].includes(line))) changes.push({ file: '.gitignore', kind: previous === undefined ? 'create' : 'modify', content: `${previous ?? ''}${previous && !previous.endsWith('\n') ? '\n' : ''}\n# Local backups may contain secrets\n.next2apk/\n` });
  });
  for (const change of changes) await capture(() => assertSafePath(root, change.file));
  if (packageManager) {
    for (const process of installCommands(packageManager, needsTypescript, reactTypes ? [reactTypes] : [])) commands.push({ step: 'install', process });
    if (report.strategy !== 'REMOTE') commands.push({ step: 'assets', process: binaryCommand(packageManager, 'next', ['build']) });
    commands.push({ step: 'android', process: binaryCommand(packageManager, 'cap', ['add', 'android']) });
    commands.push({ step: 'sync', process: binaryCommand(packageManager, 'cap', ['sync', 'android']) });
  }
  notes.push('Back up every existing project file before external commands (excluding node_modules, .git and internal journal). Package managers may run dependency lifecycle scripts; Next build executes project code. Generated files are inventoried after each step.');
  return { report, configuration, ...(packageManager ? { packageManager } : {}), changes, archivedConfigs: existing.filter(f => f !== 'capacitor.config.ts'), commands, blockers, notes, baseline };
}

export interface InitDependencies { run?: ProcessRunner; log?: (message: string) => void }
export class InitError extends Error {
  constructor(public readonly step: string, cause: unknown) { super(`Init failed at step "${step}": ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
}
export async function initializeProject(input = process.cwd(), options: InitOptions = {}, deps: InitDependencies = {}): Promise<InitPlan | InitState> {
  let step = 'analyze/plan';
  let journal: BackupJournal | undefined;
  const log = deps.log ?? (() => {});
  const run = deps.run ?? runProcess;
  try {
    const plan = await planInit(input, options);
    log(`Strategy: ${plan.report.strategy}`);
    if (options.dryRun) return plan;
    if (plan.blockers.length) throw new Error(plan.blockers.join('\n'));
    log('✓ Project analyzed');
    for (const note of plan.notes) log(note);
    const root = plan.report.root;
    step = 'backup';
    journal = await BackupJournal.create(root, plan);
    for (const entry of journal.state.backups) log(`Backup: ${entry.file} -> ${entry.backup}`);
    step = 'install';
    for (const operation of plan.commands.filter(c => c.step === 'install')) {
      await journal.checkpoint(step);
      log(`Run: ${operation.process.command} ${operation.process.args.join(' ')}`);
      await run(operation.process, root);
      await journal.checkpoint(step);
    }
    log('✓ Capacitor installed');
    step = 'configuration';
    await journal.checkpoint(step);
    for (const file of plan.archivedConfigs) {
      log(`Archive conflicting configuration: ${file}`);
      await unlink(path.join(root, file));
    }
    for (const change of plan.changes) {
      log(`${change.kind}: ${change.file}`);
      await mkdir(path.dirname(path.join(root, change.file)), { recursive: true });
      await writeFile(path.join(root, change.file), change.content, { flag: change.kind === 'create' ? 'wx' : 'w' });
    }
    await journal.checkpoint(step);
    log('✓ Configuration generated');
    for (const operation of plan.commands.filter(c => c.step !== 'install')) {
      step = operation.step;
      await journal.checkpoint(step);
      log(`Run: ${operation.process.command} ${operation.process.args.join(' ')}`);
      await run(operation.process, root);
      await journal.checkpoint(step);
      if (step === 'assets') {
        const index = path.join(root, plan.configuration.webDir, 'index.html');
        if (!(await lstat(index)).isFile()) throw new Error(`Missing web assets: ${index}`);
      }
      if (step === 'android') log('✓ Android platform created');
    }
    step = 'verify';
    for (const file of ['android/app/src/main/AndroidManifest.xml', 'android/app/build.gradle', 'android/gradlew', 'android/gradlew.bat', 'android/app/src/main/assets/capacitor.config.json']) {
      await assertSafePath(root, file);
      if (!(await lstat(path.join(root, file))).isFile()) throw new Error(`Android project is incomplete: ${file}`);
    }
    log('✓ Capacitor synchronized');
    journal.state.status = 'completed';
    await journal.checkpoint('completed');
    return journal.state;
  } catch (error) {
    if (journal) {
      journal.state.status = 'failed';
      journal.state.error = error instanceof Error ? error.message : String(error);
      try { await journal.checkpoint(step); }
      catch (journalError) { throw new InitError(step, new AggregateError([error, journalError], `${String(error)}; additionally could not persist state: ${String(journalError)}`)); }
    }
    throw new InitError(step, error);
  } finally { await journal?.close(); }
}
