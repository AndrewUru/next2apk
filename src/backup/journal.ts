import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exists, snapshot, type Snapshot } from '../project/files.js';
import type { InitPlan } from '../capacitor/initializer.js';
import type { AppConfiguration } from '../capacitor/config.js';

export interface InitState {
  version: string;
  date: string;
  strategy: string;
  configuration: AppConfiguration;
  packageManager: string;
  status: 'running' | 'completed' | 'failed';
  step: string;
  createdFiles: string[];
  modifiedFiles: string[];
  removedFiles: string[];
  backups: { file: string; backup: string }[];
  error?: string;
}
export class BackupJournal {
  private revision = 0;
  private constructor(private root: string, private baseline: Snapshot, private directory: string, public state: InitState) {}
  static async create(root: string, plan: InitPlan): Promise<BackupJournal> {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    await mkdir(path.join(root, '.next2apk'), { recursive: true });
    const lock = await open(path.join(root, '.next2apk/init.lock'), 'wx');
    await lock.close();
    const directory = `.next2apk/backups/${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
    const state: InitState = { version: pkg.version, date: new Date().toISOString(), strategy: plan.report.strategy, configuration: plan.configuration, packageManager: plan.packageManager!, status: 'running', step: 'backup', createdFiles: [], modifiedFiles: [], removedFiles: [], backups: [] };
    const journal = new BackupJournal(root, plan.baseline, directory, state);
    try {
      // Detect changes between planning and backup; never apply a stale plan.
      const current = await snapshot(root);
      if (JSON.stringify(current) !== JSON.stringify(plan.baseline)) throw new Error('Project changed since planning. Retry init.');
      for (const file of Object.keys(current)) await journal.backup(file);
      for (const file of ['.next2apk/state.json', '.next2apk/remote-web/index.html']) if (await exists(path.join(root, file))) await journal.backup(file);
      await journal.checkpoint('backup');
      return journal;
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : String(error);
      try { await journal.checkpoint('backup'); }
      catch (stateError) { throw new AggregateError([error, stateError], `${String(error)}; could not record backup failure: ${String(stateError)}`); }
      finally { await journal.close(); }
      throw error;
    }
  }
  private async backup(file: string): Promise<void> {
    const backup = `${this.directory}/files/${file}`;
    await mkdir(path.dirname(path.join(this.root, backup)), { recursive: true });
    await copyFile(path.join(this.root, file), path.join(this.root, backup), constants.COPYFILE_EXCL);
    this.state.backups.push({ file, backup });
  }
  async checkpoint(step: string): Promise<void> {
    this.state.step = step;
    const current = await snapshot(this.root);
    this.state.createdFiles = Object.keys(current).filter(f => !(f in this.baseline));
    this.state.modifiedFiles = Object.keys(current).filter(f => f in this.baseline && current[f] !== this.baseline[f]);
    this.state.removedFiles = Object.keys(this.baseline).filter(f => !(f in current));
    (this.state.backups.some(b => b.file === '.next2apk/state.json' && b.backup.includes('/files/')) ? this.state.modifiedFiles : this.state.createdFiles).push('.next2apk/state.json');
    if (await exists(path.join(this.root, '.next2apk/remote-web/index.html'))) {
      (this.state.backups.some(b => b.file === '.next2apk/remote-web/index.html') ? this.state.modifiedFiles : this.state.createdFiles).push('.next2apk/remote-web/index.html');
    }
    const statePath = path.join(this.root, '.next2apk/state.json');
    await mkdir(path.join(this.root, this.directory), { recursive: true });
    if (await exists(statePath)) {
      const backup = `${this.directory}/state-${this.revision++}.json`;
      await copyFile(statePath, path.join(this.root, backup), constants.COPYFILE_EXCL);
      this.state.backups.push({ file: '.next2apk/state.json', backup });
    }
    const temporary = path.join(this.root, `.next2apk/state-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(this.state, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, statePath);
  }
  async close(): Promise<void> { await unlink(path.join(this.root, '.next2apk/init.lock')); }
}
