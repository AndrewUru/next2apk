import { spawn } from 'node:child_process';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export interface ProcessCommand { command: PackageManager; args: string[] }
export type ProcessRunner = (command: ProcessCommand, cwd: string) => Promise<void>;
export const CAPACITOR_VERSION = '8.5.3';
export function selectPackageManager(detected: string, selected?: string): PackageManager {
  const value = selected ?? detected;
  if (!['npm', 'pnpm', 'yarn'].includes(value)) throw new Error(`Package manager "${value}" is unsupported or unknown. Specify --package-manager npm|pnpm|yarn.`);
  if (selected && detected !== 'unknown' && detected !== selected) throw new Error(`Selected package manager ${selected} conflicts with detected ${detected}. Resolve project metadata first.`);
  return value as PackageManager;
}
export function installCommands(manager: PackageManager, needsTypescript = true): ProcessCommand[] {
  return [
    { command: manager, args: [manager === 'npm' ? 'install' : 'add', `@capacitor/core@${CAPACITOR_VERSION}`, `@capacitor/android@${CAPACITOR_VERSION}`] },
    { command: manager, args: [manager === 'npm' ? 'install' : 'add', '-D', `@capacitor/cli@${CAPACITOR_VERSION}`, ...(needsTypescript ? ['typescript@5.9.3'] : [])] },
  ];
}
export function binaryCommand(manager: PackageManager, binary: 'next' | 'cap', args: string[]): ProcessCommand {
  return { command: manager, args: manager === 'npm' ? ['exec', '--no', '--', binary, ...args] : ['exec', binary, ...args] };
}
export const runProcess: ProcessRunner = async ({ command, args }, cwd) => {
  // Only fixed tokens enter cmd.exe; names, paths and URLs never enter the shell.
  if (!['npm', 'pnpm', 'yarn'].includes(command) || args.some(arg => !/^[A-Za-z0-9@/._^=-]+$/.test(arg))) throw new Error('Unsafe process command.');
  await new Promise<void>((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], { cwd, stdio: 'inherit', windowsHide: true })
      : spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code}`}. See process output above.`)));
  });
};
