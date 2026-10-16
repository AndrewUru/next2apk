import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exists } from '../project/files.js';

// Where Android Studio installs the SDK by default.
export function defaultSdkLocations(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string[] {
  if (platform === 'win32') return [path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local'), 'Android', 'Sdk')];
  if (platform === 'darwin') return [path.posix.join(home, 'Library', 'Android', 'sdk')];
  return [path.posix.join(home, 'Android', 'Sdk'), path.posix.join(home, 'Android', 'sdk')];
}
export interface ResolvedSdk { path: string; source: 'local.properties' | 'environment' | 'default' }
export async function resolveAndroidSdk(root: string, env: NodeJS.ProcessEnv = process.env, defaults: string[] = defaultSdkLocations(env)): Promise<ResolvedSdk | undefined> {
  const properties = path.join(root, 'android/local.properties');
  if (await exists(properties)) {
    const value = (await readFile(properties, 'utf8')).match(/^\s*sdk\.dir\s*=\s*(.+?)\s*$/m)?.[1];
    if (value) return { path: path.resolve(root, 'android', value.replace(/\\([\\:= ])/g, '$1')), source: 'local.properties' };
  }
  const configured = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (configured) return { path: configured, source: 'environment' };
  for (const candidate of defaults) if (await exists(path.join(candidate, 'platforms'))) return { path: candidate, source: 'default' };
  return undefined;
}
export async function findAndroidSdk(root: string, env: NodeJS.ProcessEnv = process.env, defaults?: string[]): Promise<string | undefined> {
  return (await resolveAndroidSdk(root, env, defaults))?.path;
}
export async function validateSdk(root: string): Promise<string> {
  const sdk = await findAndroidSdk(root);
  if (!sdk) throw new Error('Android SDK not found. Install it with Android Studio, then set ANDROID_HOME or android/local.properties (sdk.dir). Run next2apk doctor.');
  const variables = await readFile(path.join(root, 'android/variables.gradle'), 'utf8');
  const api = variables.match(/\bcompileSdkVersion\s*=\s*(\d+)/)?.[1];
  if (!api) throw new Error('Cannot determine compileSdkVersion from android/variables.gradle.');
  if (!await exists(path.join(sdk, `platforms/android-${api}/android.jar`))) throw new Error(`Android SDK platform android-${api} is missing. Install it with: sdkmanager "platforms;android-${api}" (or Android Studio > SDK Manager). Run next2apk doctor.`);
  const directory = path.join(sdk, 'build-tools');
  const versions = await exists(directory) ? await readdir(directory) : [];
  const binary = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const appGradle = await readFile(path.join(root, 'android/app/build.gradle'), 'utf8');
  const configuredTools = `${variables}\n${appGradle}`.match(/\bbuildToolsVersion\s*(?:=\s*)?['"]([\d.]+)['"]/)?.[1];
  let available = false;
  // Capacitor 8's AGP 8.13 template defaults to Build Tools 35.0.0.
  const expected = configuredTools ?? '35.0.0';
  for (const version of versions) if (version === expected && await exists(path.join(directory, version, binary))) available = true;
  if (!available) throw new Error(`Android SDK build-tools ${expected} (aapt2) not found. Install it with: sdkmanager "build-tools;${expected}" (or Android Studio > SDK Manager > SDK Tools > Show Package Details). Newer build-tools do not substitute: Android Gradle Plugin selects this exact version. next2apk never installs the SDK automatically.`);
  return sdk;
}
