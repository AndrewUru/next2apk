import { buildProject } from '../build/builder.js';
import type { BuildOptions } from '../build/pipeline.js';

export async function buildCommand(directory = process.cwd(), options: BuildOptions = {}): Promise<void> {
  const result = await buildProject(directory, options, { log: console.log });
  if ('operations' in result) {
    console.log(`Strategy: ${result.report.strategy}\nBuild plan:\n\n1. Validate Java, SDK, installed tools and wrapper compatibility (not executed in dry-run)`);
    console.log('2. Acquire init/build lock; remove only hash-verified previously published next2apk APK and build.json');
    let index = 3;
    for (const operation of result.operations) console.log(`${index++}. ${operation.command.command} ${operation.command.args.join(' ')} [cwd: ${operation.cwd}]`);
    console.log(`${index}. Validate fresh debug APK; copy to dist/android/ and write build.json\n\nNo files were modified.`);
    return;
  }
  console.log(`\nAPK READY\n\ndist/android/${result.artifact}\n\n${(result.size / 1024 / 1024).toFixed(2)} MB (${result.size} bytes)\n\nDebug APK for testing; not a release artifact.`);
}
