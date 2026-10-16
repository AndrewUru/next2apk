#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeProject } from '../analyzer/index.js';
import { doctor } from '../doctor/index.js';
import { formatReport } from './format.js';
import { initCommand } from '../commands/init.js';
import type { InitOptions } from '../capacitor/initializer.js';
import { buildCommand } from '../commands/build.js';
import type { BuildOptions } from '../build/pipeline.js';

const program = new Command();
program.name('next2apk').description('Analyze and prepare Next.js projects for Android').version('0.1.0');
async function analyze(directory: string, json = false): Promise<void> {
  const report = await analyzeProject(directory);
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  if (report.compatibility === 'FAIL') process.exitCode = 1;
}
program.command('analyze [path]').description('Analyze without modifying the project').option('--json', 'Print a machine-readable report').action(async (directory: string | undefined, options: { json?: boolean }) => analyze(directory ?? process.cwd(), options.json));
program.command('init [path]').description('Prepare Capacitor Android with backups')
  .option('--app-name <name>', 'Application display name (defaults to directory name)')
  .option('--app-id <id>', 'Android application ID, e.g. com.example.myapp')
  .option('--remote-url <url>', 'Deployed HTTPS Next.js URL for REMOTE strategy')
  .option('--package-manager <manager>', 'Select npm, pnpm or yarn if detection is unknown')
  .option('--dry-run', 'Print the complete plan without writing files or running processes')
  .option('--force', 'Back up and replace existing Capacitor configuration')
  .action(async (directory: string | undefined, options: InitOptions) => initCommand(directory ?? process.cwd(), options));
program.command('build [path]').description('Build a debug APK from an initialized project')
  .option('--dry-run', 'Print the build pipeline without executing tools or modifying files')
  .option('--clean', 'Clean Gradle build outputs; remove only verified next2apk published artifacts')
  .action(async (directory: string | undefined, options: BuildOptions) => buildCommand(directory ?? process.cwd(), options));
program.command('doctor').description('Check local tool availability (not full version compatibility)').action(async () => {
  const checks = await doctor();
  for (const check of checks) console.log(`[${check.status}] ${check.name}: ${check.detail}`);
  if (checks.some(c => c.status === 'FAIL')) process.exitCode = 1;
});
program.action(async () => analyze(process.cwd()));
try { await program.parseAsync(); }
catch (error) { console.error(`next2apk: ${error instanceof Error ? error.message : 'Unexpected failure'}`); process.exitCode = 1; }
