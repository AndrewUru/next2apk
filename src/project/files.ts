import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export async function assertSafePath(root: string, relative: string): Promise<void> {
  const parts = relative.replaceAll('\\', '/').split('/');
  if (path.isAbsolute(relative) || parts.some(p => !p || p === '..' || p === '.') || relative.includes(':')) throw new Error(`Unsafe project path: ${relative}`);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (await exists(current) && (await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${relative}`);
  }
}
export type Snapshot = Record<string, string>;
export async function snapshot(root: string): Promise<Snapshot> {
  const files: Snapshot = {};
  async function walk(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (['node_modules', '.git', '.next2apk'].includes(entry.name)) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in project snapshot: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
    }
  }
  await walk('');
  return files;
}
