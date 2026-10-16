import { spawn } from 'node:child_process';
import type { ProcessCommand } from '../capacitor/installer.js';

export type BuildCommand = ProcessCommand | { command: 'gradlew.bat' | './gradlew'; args: string[] };
export type BuildRunner = (command: BuildCommand, cwd: string) => Promise<void>;
export function gradleCommand(platform: NodeJS.Platform = process.platform, clean = false): BuildCommand {
  return { command: platform === 'win32' ? 'gradlew.bat' : './gradlew', args: [...(clean ? ['clean'] : []), 'assembleDebug', '--rerun-tasks', '--console=plain', '--no-daemon', '-Pandroid.builder.sdkDownload=false'] };
}
export class GradleError extends Error {
  constructor(public readonly exitCode: number | null, public readonly stdout: string, public readonly stderr: string) {
    super(`Gradle failed (exit ${exitCode}).\n${stderr || stdout}`);
  }
}
export async function runGradle(command: BuildCommand, cwd: string): Promise<void> {
  if (!['gradlew.bat', './gradlew'].includes(command.command) || command.args.some(a => !['clean', 'assembleDebug', '--rerun-tasks', '--console=plain', '--no-daemon', '-Pandroid.builder.sdkDownload=false'].includes(a))) throw new Error('Unsupported Gradle command.');
  await new Promise<void>((resolve, reject) => {
    const child = command.command === 'gradlew.bat'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `gradlew.bat ${command.args.join(' ')}`], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('./gradlew', command.args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    // Bound retained diagnostics, while streaming all output. Do not dump environment variables.
    child.stdout.on('data', (data: Buffer) => { process.stdout.write(data); stdout = (stdout + data.toString()).slice(-65536); });
    child.stderr.on('data', (data: Buffer) => { process.stderr.write(data); stderr = (stderr + data.toString()).slice(-65536); });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new GradleError(code, stdout, `${signal ? `Signal: ${signal}\n` : ''}${stderr}`)));
  });
}
