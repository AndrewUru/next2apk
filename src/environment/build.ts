import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { doctor, type DoctorCheck } from '../doctor/index.js';
import { validateSdk } from './sdk.js';
import type { PackageManager } from '../capacitor/installer.js';

export interface EnvironmentDependencies {
  inspect?: (root: string) => Promise<DoctorCheck[]>;
  sdk?: (root: string) => Promise<string>;
}
export async function validateBuildEnvironment(root: string, manager: PackageManager, deps: EnvironmentDependencies = {}): Promise<void> {
  const checks = await (deps.inspect ?? doctor)(root);
  const errors: string[] = [];
  for (const name of ['Node', manager, 'Java', 'Javac', 'Android SDK', 'next', '@capacitor/core', '@capacitor/cli', '@capacitor/android']) {
    const check = checks.find(c => c.name === name);
    if (check?.status !== 'PASS') errors.push(`${name}: ${check?.detail ?? 'not found'}`);
  }
  try { await (deps.sdk ?? validateSdk)(root); } catch (error) { errors.push((error as Error).message); }
  const java = Number(checks.find(c => c.name === 'Java')?.detail.match(/(?:version\s+"?|openjdk\s+)(\d+)/)?.[1]);
  const wrapper = await readFile(path.join(root, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8');
  const version = wrapper.match(/gradle-(\d+)\.(\d+)(?:\.\d+)?-(?:all|bin)\.zip/)?.slice(1).map(Number);
  if (!java || java < 21) errors.push('Capacitor 8 Android builds require JDK 21 or newer; set JAVA_HOME to a compatible JDK.');
  const minima: Record<number, [number, number]> = { 21: [8, 5], 22: [8, 8], 23: [8, 10], 24: [8, 14], 25: [9, 1], 26: [9, 4] };
  const required = minima[java];
  if (!version || !required || version[0]! < required[0] || (version[0] === required[0] && version[1]! < required[1])) errors.push(`Java ${java || 'unknown'} is not supported by the detected Gradle wrapper. Use a compatible JDK (JDK 21 is recommended for init's Capacitor 8 template).`);
  if (errors.length) throw new Error(`${errors.join('\n')}\nRun: next2apk doctor\nNo build commands were started.`);
}
