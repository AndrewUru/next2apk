#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeProject } from '../analyzer/index.js';
import { doctor } from '../doctor/index.js';
import { formatReport } from './format.js';

const program = new Command();
program.name('next2apk').description('Inspect Next.js projects for Android preparation (increment 1)').version('0.1.0');
async function analyze(directory: string, json = false): Promise<void> {
  const report = await analyzeProject(directory);
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  if (report.compatibility === 'FAIL') process.exitCode = 1;
}
program.command('analyze [path]').description('Analyze without modifying the project').option('--json', 'Print a machine-readable report').action(async (directory: string | undefined, options: { json?: boolean }) => analyze(directory ?? process.cwd(), options.json));
for (const command of ['init', 'build']) {
  program.command(`${command} [path]`).description(`Reserved for the ${command === 'init' ? 'Capacitor' : 'Android build'} increment`).action(() => {
    console.error(`${command} is not implemented in increment 1. Run next2apk analyze [path] first. No project files were changed.`);
    process.exitCode = 2;
  });
}
program.command('doctor').description('Check local tool availability (not full version compatibility)').action(async () => {
  const checks = await doctor();
  for (const check of checks) console.log(`[${check.status}] ${check.name}: ${check.detail}`);
  if (checks.some(c => c.status === 'FAIL')) process.exitCode = 1;
});
program.action(async () => analyze(process.cwd()));
try { await program.parseAsync(); }
catch (error) { console.error(`next2apk: ${error instanceof Error ? error.message : 'Unexpected failure'}`); process.exitCode = 1; }
