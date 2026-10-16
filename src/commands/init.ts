import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { initializeProject, planInit, InitError, type InitOptions, type InitPlan } from '../capacitor/initializer.js';

export function formatInitPlan(plan: InitPlan): string {
  return [
    `Strategy: ${plan.report.strategy}`, `App: ${plan.configuration.appName} (${plan.configuration.appId})`,
    `Web directory: ${plan.configuration.webDir}`, '', 'Planned changes:',
    ...Object.keys(plan.baseline).map(file => `+ backup ${file} -> .next2apk/backups/<run>/files/${file}`),
    '+ create/update .next2apk/state.json (backup previous state on every update)',
    '+ create temporary .next2apk/init.lock; remove when finished',
    ...plan.archivedConfigs.map(file => `~ archive ${file} in backups and remove conflicting original (--force required)`),
    ...plan.changes.map(change => `${change.kind === 'create' ? '+' : '~'} ${change.kind} ${change.file}${change.kind === 'modify' ? ' (with backup)' : ''}`),
    ...plan.commands.map(c => `+ run ${c.process.command} ${c.process.args.join(' ')}`),
    '~ package.json, selected lockfile and node_modules/ changed by dependency installation',
    ...(plan.report.strategy === 'REMOTE' ? [] : [`+ generate ${plan.configuration.webDir}/ and .next/ via Next.js; Next may update tsconfig.json and next-env.d.ts (existing files backed up)`]),
    '+ create android/ and synchronize Android assets, configuration and plugins',
    '+ verify AndroidManifest.xml, app/build.gradle, Gradle wrappers and synchronized config',
    '', 'Configuration preview:', plan.changes.find(c => c.file === 'capacitor.config.ts')?.content ?? '(invalid configuration)',
    ...plan.changes.filter(c => c.file.startsWith('next.config.')).flatMap(c => [`${c.file} preview:`, c.content]),
    '', ...plan.notes.map(note => `Note: ${note}`),
    ...(plan.blockers.length ? ['', 'Blocked until resolved:', ...plan.blockers.map(b => `- ${b}`)] : []),
    '', 'External tools determine dependency and generated file names at execution time; their output is not simulated.',
    'No files were modified.',
  ].join('\n');
}
async function performInitCommand(directory: string, options: InitOptions): Promise<void> {
  if (options.dryRun) {
    const plan = await planInit(directory, options);
    console.log(formatInitPlan(plan));
    if (plan.blockers.length) process.exitCode = 1;
    return;
  }
  // Inspect before asking questions, without executing project code or changing files.
  const preview = await planInit(directory, { ...options, dryRun: true });
  console.log(`Strategy: ${preview.report.strategy}`);
  if (stdin.isTTY && stdout.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      if (!options.appName) options.appName = (await rl.question(`Application name [${path.basename(preview.report.root)}]: `)).trim() || path.basename(preview.report.root);
      if (!options.appId) options.appId = (await rl.question('Application ID (e.g. com.example.myapp): ')).trim();
      if (preview.report.packageManager === 'unknown' && !options.packageManager) options.packageManager = (await rl.question('Package manager (npm/pnpm/yarn): ')).trim();
      if (preview.report.strategy === 'REMOTE' && !options.remoteUrl) options.remoteUrl = (await rl.question('Deployed Next.js HTTPS URL: ')).trim();
    } finally { rl.close(); }
  }
  await initializeProject(directory, options, { log: console.log });
  console.log('\nAndroid project ready.\n\nNext step:\n\nnext2apk build\n\nInit did not execute a Gradle build.');
}
export async function initCommand(directory = process.cwd(), options: InitOptions = {}): Promise<void> {
  try { await performInitCommand(directory, options); }
  catch (error) { throw error instanceof InitError ? error : new InitError('analyze/plan', error); }
}
