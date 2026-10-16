import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { exists } from '../project/files.js';

export async function findAndroidSdk(root: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const properties = path.join(root, 'android/local.properties');
  if (await exists(properties)) {
    const value = (await readFile(properties, 'utf8')).match(/^\s*sdk\.dir\s*=\s*(.+?)\s*$/m)?.[1];
    if (value) return path.resolve(root, 'android', value.replace(/\\([\\:= ])/g, '$1'));
  }
  return env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
}
export async function validateSdk(root: string): Promise<string> {
  const sdk = await findAndroidSdk(root);
  if (!sdk) throw new Error('Android SDK not found. Configure ANDROID_HOME or android/local.properties. Run next2apk doctor.');
  const variables = await readFile(path.join(root, 'android/variables.gradle'), 'utf8');
  const api = variables.match(/\bcompileSdkVersion\s*=\s*(\d+)/)?.[1];
  if (!api) throw new Error('Cannot determine compileSdkVersion from android/variables.gradle.');
  if (!await exists(path.join(sdk, `platforms/android-${api}/android.jar`))) throw new Error(`Android SDK platform android-${api} is missing. Run next2apk doctor.`);
  const directory = path.join(sdk, 'build-tools');
  const versions = await exists(directory) ? await readdir(directory) : [];
  const binary = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const appGradle = await readFile(path.join(root, 'android/app/build.gradle'), 'utf8');
  const configuredTools = `${variables}\n${appGradle}`.match(/\bbuildToolsVersion\s*(?:=\s*)?['"]([\d.]+)['"]/)?.[1];
  let available = false;
  // Capacitor 8's AGP 8.13 template defaults to Build Tools 35.0.0.
  const expected = configuredTools ?? '35.0.0';
  for (const version of versions) if (version === expected && await exists(path.join(directory, version, binary))) available = true;
  if (!available) throw new Error(`Android SDK build-tools ${expected} (aapt2) not found. Run next2apk doctor. SDK installation is not automatic.`);
  return sdk;
}
