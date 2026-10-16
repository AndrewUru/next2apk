import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { findAndroidSdk } from '../environment/sdk.js';
import { findCompatibleJdk, isJdkSupported, parseGradleVersion, parseJavaMajor } from '../environment/jdk.js';
import { exists } from '../project/files.js';

const exec = promisify(execFile);
export interface DoctorCheck { name: string; status: 'PASS' | 'WARNING' | 'FAIL'; detail: string }
export async function doctor(root = process.cwd()): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [{ name: 'Node', status: Number(process.versions.node.split('.')[0]) >= 22 ? 'PASS' : 'FAIL', detail: `${process.version}; next2apk requires Node >=22.` }];
  async function probe(name: string, command: string, args: string[], help: string, required = false): Promise<void> {
    try {
      // Only fixed tool names/arguments enter cmd.exe; never interpolate project paths.
      const windowsScript = process.platform === 'win32' && ['npm', 'pnpm', 'yarn'].includes(command);
      const result = windowsScript
        ? await exec('cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], { timeout: 10000, windowsHide: true })
        : await exec(command, args, { timeout: 10000, windowsHide: true });
      checks.push({ name, status: 'PASS', detail: (result.stdout || result.stderr).trim().split(/\r?\n/)[0] || 'Available' });
    } catch { checks.push({ name, status: required ? 'FAIL' : 'WARNING', detail: help }); }
  }
  await probe('npm', 'npm', ['--version'], 'Install npm with Node.js.');
  await probe('pnpm', 'pnpm', ['--version'], 'Optional: install pnpm if selected by the project.');
  await probe('yarn', 'yarn', ['--version'], 'Optional: install Yarn if selected by the project.');
  const javaBinary = (name: string) => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
  await probe('Java', javaBinary('java'), ['-version'], 'Install the JDK required by the selected Capacitor/Gradle version and configure JAVA_HOME and PATH.', true);
  await probe('Javac', javaBinary('javac'), ['-version'], 'Install a full JDK, not only a JRE, and configure JAVA_HOME.', true);
  const sdk = await findAndroidSdk(root);
  try {
    if (!sdk) throw new Error('missing');
    await access(path.join(sdk, 'platforms'));
    await access(path.join(sdk, 'build-tools'));
    checks.push({ name: 'Android SDK', status: 'PASS', detail: 'SDK platforms and build-tools directories exist; required versions are not yet validated.' });
  } catch { checks.push({ name: 'Android SDK', status: 'FAIL', detail: 'Install Android SDK platforms/build-tools via Android Studio and set ANDROID_HOME to the SDK directory.' }); }
  try {
    await access(path.join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'));
    checks.push({ name: 'Gradle', status: 'PASS', detail: 'Project Gradle wrapper found; execution and version compatibility not yet validated.' });
  } catch { await probe('Gradle', 'gradle', ['--version'], 'No project wrapper/global Gradle found. Capacitor Android will provide a Gradle wrapper; global Gradle is optional.'); }
  // Same decision `build` makes, so doctor and build cannot disagree about the JDK.
  const wrapperFile = path.join(root, 'android/gradle/wrapper/gradle-wrapper.properties');
  const gradle = await exists(wrapperFile) ? parseGradleVersion(await readFile(wrapperFile, 'utf8')) : undefined;
  if (gradle) {
    const java = checks.find(c => c.name === 'Java');
    const major = parseJavaMajor(java?.detail ?? '');
    const gradleName = `Gradle ${gradle.join('.')}`;
    if (java?.status === 'PASS' && isJdkSupported(major, gradle)) checks.push({ name: 'Gradle JDK', status: 'PASS', detail: `JDK ${major} can run the project's ${gradleName}.` });
    else if (process.env.JAVA_HOME) checks.push({ name: 'Gradle JDK', status: 'FAIL', detail: `JAVA_HOME is set to a JDK that the project's ${gradleName} cannot use. next2apk never overrides JAVA_HOME: point it to JDK 21.` });
    else {
      const found = await findCompatibleJdk(gradle);
      checks.push(found
        ? { name: 'Gradle JDK', status: 'PASS', detail: `The JDK on PATH${major ? ` (${major})` : ''} cannot run ${gradleName}; build will use the Android Studio JDK at ${found}.` }
        : { name: 'Gradle JDK', status: 'FAIL', detail: `No JDK able to run ${gradleName} found. Install JDK 21 (or Android Studio) and set JAVA_HOME.` });
    }
  }
  const require = createRequire(path.join(path.resolve(root), 'package.json'));
  for (const name of ['next', '@capacitor/core', '@capacitor/cli', '@capacitor/android']) {
    try { require.resolve(`${name}/package.json`); checks.push({ name, status: 'PASS', detail: 'Installed in project resolution path.' }); }
    catch { checks.push({ name, status: 'WARNING', detail: 'Not installed. Run next2apk init to install compatible Capacitor packages.' }); }
  }
  return checks;
}
