import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { doctor, type DoctorCheck } from '../doctor/index.js';
import { resolveAndroidSdk, validateSdk } from './sdk.js';
import { findCompatibleJdk, isJdkSupported, parseGradleVersion, parseJavaMajor } from './jdk.js';
import type { PackageManager } from '../capacitor/installer.js';

export interface EnvironmentDependencies {
  inspect?: (root: string) => Promise<DoctorCheck[]>;
  sdk?: (root: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
  findJdk?: typeof findCompatibleJdk;
  sdkDefaults?: string[];
}
export interface BuildEnvironment {
  /** Set only when the JDK on PATH is unusable and a compatible one was found; Gradle must run with it. */
  javaHome?: string;
  /** Set only when the SDK came from its default location: Gradle cannot find it on its own. */
  androidHome?: string;
  notes: string[];
}
export async function validateBuildEnvironment(root: string, manager: PackageManager, deps: EnvironmentDependencies = {}): Promise<BuildEnvironment> {
  const checks = await (deps.inspect ?? doctor)(root);
  const env = deps.env ?? process.env;
  const errors: string[] = [];
  const notes: string[] = [];
  for (const name of ['Node', manager, 'Android SDK', 'next', '@capacitor/core', '@capacitor/cli', '@capacitor/android']) {
    const check = checks.find(c => c.name === name);
    if (check?.status !== 'PASS') errors.push(`${name}: ${check?.detail ?? 'not found'}`);
  }
  try { await (deps.sdk ?? validateSdk)(root); } catch (error) { errors.push((error as Error).message); }
  const sdk = await resolveAndroidSdk(root, env, deps.sdkDefaults);
  const androidHome = sdk?.source === 'default' ? sdk.path : undefined;
  if (androidHome) notes.push(`Using the Android SDK at ${androidHome} for Gradle (default Android Studio location; ANDROID_HOME is not set). Set ANDROID_HOME to choose another.`);
  const gradle = parseGradleVersion(await readFile(path.join(root, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8'));
  const javaChecks = ['Java', 'Javac'].map(name => checks.find(c => c.name === name));
  const java = parseJavaMajor(javaChecks[0]?.detail ?? '');
  const pathJdkUsable = javaChecks.every(c => c?.status === 'PASS') && isJdkSupported(java, gradle);
  let javaHome: string | undefined;
  // An explicit JAVA_HOME is the developer's decision and is never replaced.
  if (!pathJdkUsable && !env.JAVA_HOME) {
    javaHome = await (deps.findJdk ?? findCompatibleJdk)(gradle);
    if (javaHome) notes.push(`Using the Android Studio JDK at ${javaHome} for Gradle because the JDK on PATH ${java ? `(${java}) ` : ''}cannot build this project. Set JAVA_HOME to choose another.`);
  }
  if (!javaHome && !pathJdkUsable) {
    for (const check of javaChecks) if (check?.status !== 'PASS') errors.push(`${check?.name ?? 'Java'}: ${check?.detail ?? 'not found'}`);
    if (!java || java < 21) errors.push('Capacitor 8 Android builds require JDK 21 or newer; set JAVA_HOME to a compatible JDK.');
    else errors.push(`Java ${java} is not supported by the detected Gradle wrapper. Use a compatible JDK (JDK 21 is recommended for init's Capacitor 8 template).`);
  }
  if (errors.length) throw new Error(`${errors.join('\n')}\nRun: next2apk doctor\nNo build commands were started.`);
  return { ...(javaHome ? { javaHome } : {}), ...(androidHome ? { androidHome } : {}), notes };
}
