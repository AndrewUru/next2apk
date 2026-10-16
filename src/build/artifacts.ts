import { copyFile, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertSafePath, exists } from '../project/files.js';
import type { BuildPlan } from './pipeline.js';

export interface ArtifactMetadata {
  producer: 'next2apk'; schemaVersion: 1; type: 'apk'; variant: 'debug';
  appName: string; appId: string; strategy: string; createdAt: string;
  artifact: string; size: number; sha256: string;
}
export const artifactName = (name: string): string => `${name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'app'}-debug.apk`;
const digest = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

export async function filesUnder(root: string, relative: string): Promise<string[]> {
  await assertSafePath(root, relative);
  if (!await exists(path.join(root, relative))) return [];
  const result: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in build output: ${file}`);
    if (entry.isDirectory()) result.push(...await filesUnder(root, file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}
export async function validateWebOutput(root: string, webDir: string): Promise<void> {
  await assertSafePath(root, `${webDir}/index.html`);
  const index = path.join(root, webDir, 'index.html');
  if (!await exists(index) || !(await lstat(index)).isFile() || (await lstat(index)).size === 0) throw new Error(`Missing or empty web output: ${webDir}/index.html`);
  await rejectEnvFiles(root, webDir);
}
export async function rejectEnvFiles(root: string, directory: string): Promise<void> {
  if ((await filesUnder(root, directory)).some(f => /^\.env(?:\.|$)/i.test(path.basename(f)))) throw new Error(`Environment file detected in ${directory}; refusing to package .env files.`);
}
export async function apkSnapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of await filesUnder(root, 'android/app/build/outputs/apk')) {
    if (!file.endsWith('.apk') || !/(?:\/debug\/|-debug\.apk$)/i.test(file)) continue;
    const info = await lstat(path.join(root, file));
    result[file] = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${digest(await readFile(path.join(root, file)))}`;
  }
  return result;
}
export async function discoverApk(root: string, before: Record<string, string>): Promise<string> {
  const after = await apkSnapshot(root);
  const fresh = Object.keys(after).filter(f => after[f] !== before[f]);
  if (!fresh.length) throw new Error('No newly generated debug APK found. Existing stale APKs are not accepted.');
  if (fresh.length !== 1) throw new Error('Multiple debug APKs generated. Split APKs/flavors require explicit support; refusing to select an arbitrary artifact.');
  const file = fresh[0]!;
  const buffer = await readFile(path.join(root, file));
  if (!buffer.length) throw new Error(`Generated APK is empty: ${file}`);
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error(`Generated APK is not a ZIP/APK container: ${file}`);
  return file;
}
export async function ownedArtifact(plan: BuildPlan): Promise<ArtifactMetadata | undefined> {
  const { root } = plan;
  const metadataPath = 'dist/android/build.json';
  await assertSafePath(root, metadataPath);
  const destination = `dist/android/${artifactName(plan.configuration.appName)}`;
  await assertSafePath(root, destination);
  if (!await exists(path.join(root, metadataPath))) {
    if (await exists(path.join(root, destination))) throw new Error('Destination APK is not owned by next2apk; move it manually before building.');
    return;
  }
  let data: ArtifactMetadata;
  try { data = JSON.parse(await readFile(path.join(root, metadataPath), 'utf8')) as ArtifactMetadata; }
  catch { throw new Error('Invalid existing dist/android/build.json; refusing to overwrite or clean it.'); }
  if (!data || data.producer !== 'next2apk' || data.schemaVersion !== 1 || data.type !== 'apk' || data.variant !== 'debug' || data.appId !== plan.configuration.appId || typeof data.appName !== 'string' || data.artifact !== artifactName(data.appName) || !/^[a-f0-9]{64}$/.test(data.sha256) || !Number.isSafeInteger(data.size) || data.size <= 0) throw new Error('Unrecognized artifact metadata; refusing destructive cleanup.');
  await assertSafePath(root, `dist/android/${data.artifact}`);
  const file = path.join(root, 'dist/android', data.artifact);
  if (await exists(file)) {
    const bytes = await readFile(file);
    if (bytes.length !== data.size || digest(bytes) !== data.sha256) throw new Error('Published APK was modified outside next2apk; refusing to delete or overwrite it.');
  }
  if (data.artifact !== path.basename(destination) && await exists(path.join(root, destination))) throw new Error('New artifact destination already exists and is not owned by this build.');
  return data;
}
export async function clearPublishedArtifact(plan: BuildPlan): Promise<void> {
  const previous = await ownedArtifact(plan);
  if (!previous) return;
  const file = path.join(plan.root, 'dist/android', previous.artifact);
  if (await exists(file)) await unlink(file);
  await unlink(path.join(plan.root, 'dist/android/build.json'));
}
export async function publishApk(plan: BuildPlan, source: string): Promise<ArtifactMetadata> {
  const bytes = await readFile(path.join(plan.root, source));
  const artifact = artifactName(plan.configuration.appName);
  const metadata: ArtifactMetadata = { producer: 'next2apk', schemaVersion: 1, type: 'apk', variant: 'debug', appName: plan.configuration.appName, appId: plan.configuration.appId, strategy: plan.report.strategy, createdAt: new Date().toISOString(), artifact, size: bytes.length, sha256: digest(bytes) };
  await assertSafePath(plan.root, 'dist/android');
  const directory = path.join(plan.root, 'dist/android');
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.next2apk-${randomUUID()}.tmp`);
  const target = path.join(directory, artifact);
  let copied = false;
  try {
    // Exclusive destination: never replace an untracked concurrent writer's file.
    await copyFile(path.join(plan.root, source), target, 1);
    copied = true;
    if (digest(await readFile(target)) !== metadata.sha256) throw new Error('APK changed during copying.');
    await writeFile(temporary, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    if (await exists(path.join(directory, 'build.json'))) throw new Error('Artifact metadata appeared during publication; refusing replacement.');
    await rename(temporary, path.join(directory, 'build.json'));
    return metadata;
  } catch (error) {
    if (copied) await unlink(target);
    if (await exists(temporary)) await unlink(temporary);
    throw error;
  }
}
