import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { exists } from '../project/files.js';

const exec = promisify(execFile);
// Minimum Gradle (major, minor) able to run on each JDK major version.
const gradleMinima: Record<number, [number, number]> = { 21: [8, 5], 22: [8, 8], 23: [8, 10], 24: [8, 14], 25: [9, 1], 26: [9, 4] };

export function parseJavaMajor(output: string): number | undefined {
  const major = output.match(/(?:version\s+"?|openjdk\s+)(\d+)/)?.[1];
  return major ? Number(major) : undefined;
}
export function parseGradleVersion(wrapperProperties: string): [number, number] | undefined {
  const version = wrapperProperties.match(/gradle-(\d+)\.(\d+)(?:\.\d+)?-(?:all|bin)\.zip/)?.slice(1).map(Number);
  return version ? [version[0]!, version[1]!] : undefined;
}
export function isJdkSupported(major: number | undefined, gradle: [number, number] | undefined): boolean {
  const required = major ? gradleMinima[major] : undefined;
  if (!major || major < 21 || !required || !gradle) return false;
  return gradle[0] > required[0] || (gradle[0] === required[0] && gradle[1] >= required[1]);
}
// JDK bundled with Android Studio (JetBrains Runtime), the one Android projects are meant to build with.
export function androidStudioJdkLocations(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string[] {
  if (platform === 'win32') {
    const roots = [env.ProgramFiles ?? 'C:\\Program Files', env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Programs') : undefined];
    return roots.filter((r): r is string => Boolean(r)).map(r => path.win32.join(r, 'Android', 'Android Studio', 'jbr'));
  }
  if (platform === 'darwin') return ['/Applications/Android Studio.app/Contents/jbr/Contents/Home', path.posix.join(home, 'Applications', 'Android Studio.app', 'Contents', 'jbr', 'Contents', 'Home')];
  return ['/opt/android-studio/jbr', '/usr/local/android-studio/jbr', path.posix.join(home, 'android-studio', 'jbr')];
}
export async function probeJavaMajor(javaHome: string, platform: NodeJS.Platform = process.platform): Promise<number | undefined> {
  const binary = (name: string) => path.join(javaHome, 'bin', `${name}${platform === 'win32' ? '.exe' : ''}`);
  // A JRE cannot compile Android code: require javac as well as java.
  if (!await exists(binary('java')) || !await exists(binary('javac'))) return undefined;
  try {
    const result = await exec(binary('java'), ['-version'], { timeout: 10000, windowsHide: true });
    return parseJavaMajor(`${result.stdout}\n${result.stderr}`);
  } catch { return undefined; }
}
/** Returns a compatible JDK home, or undefined when none of the candidates qualifies. */
export async function findCompatibleJdk(gradle: [number, number] | undefined, candidates = androidStudioJdkLocations(), probe = probeJavaMajor): Promise<string | undefined> {
  for (const candidate of candidates) if (isJdkSupported(await probe(candidate), gradle)) return candidate;
  return undefined;
}
