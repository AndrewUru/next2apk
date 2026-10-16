import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeProject } from '../src/index.js';

const fixture = (name: string) => path.resolve('fixtures', name);
async function project(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'next2apk test '));
  try {
    for (const [file, content] of Object.entries({ 'package.json': '{"dependencies":{"next":"16.x"}}', 'app/page.tsx': 'export default function Page() { return <main/>; }', ...files })) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), content);
    }
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('static fixture is a candidate, not a guaranteed build', async () => {
  const r = await analyzeProject(fixture('static-next'));
  assert.equal(r.compatibility, 'PASS'); assert.equal(r.strategy, 'STATIC');
  assert.equal(r.router, 'App Router'); assert.equal(r.typescript, true); assert.equal(r.packageManager, 'npm'); assert.equal(r.nextVersion, '16.x');
});
test('Supabase requires review and an external backend without leaking values', async () => {
  const r = await analyzeProject(fixture('supabase-next'));
  assert.equal(r.supabase, true); assert.equal(r.strategy, 'HYBRID'); assert.equal(r.compatibility, 'WARNING');
  assert.ok(r.environmentVariables.includes('NEXT_PUBLIC_SUPABASE_URL'));
  assert.ok(!JSON.stringify(r).includes('example-only')); assert.ok(!JSON.stringify(r).includes('https://example.supabase.co'));
});
test('inline Server Action blocks static export', async () => {
  const r = await analyzeProject(fixture('server-actions-next'));
  assert.equal(r.compatibility, 'FAIL'); assert.equal(r.strategy, 'REMOTE'); assert.equal(r.features.serverActions.length, 1);
});
test('Pages API route needs backend extraction', async () => {
  const r = await analyzeProject(fixture('api-routes-next'));
  assert.equal(r.compatibility, 'FAIL'); assert.equal(r.strategy, 'HYBRID'); assert.equal(r.router, 'Pages Router');
});
test('configuration is never executed and analysis does not write files', async () => {
  await project({ 'next.config.mjs': 'throw new Error("DO NOT EXECUTE"); export default {output:"export"};' }, async root => {
    const before = await readdir(root, { recursive: true });
    const content = await readFile(path.join(root, 'next.config.mjs'), 'utf8');
    const r = await analyzeProject(root);
    assert.equal(r.compatibility, 'WARNING'); assert.deepEqual(r.configFiles, ['next.config.mjs']);
    assert.deepEqual(await readdir(root, { recursive: true }), before);
    assert.equal(await readFile(path.join(root, 'next.config.mjs'), 'utf8'), content);
  });
});
test('comments and arbitrary strings are not Server Actions; Server Components can export', async () => {
  await project({ 'app/page.tsx': '// "use server"\nconst example = "use server"; export default async function Page() { return <main/>; }' }, async root => {
    assert.equal((await analyzeProject(root)).compatibility, 'PASS');
  });
});
test('GET handler requires review; POST handler is a blocker', async () => {
  await project({ 'app/data/route.ts': 'export const dynamic = "force-static"; export function GET() { return Response.json({ok:true}); }' }, async root => {
    const r = await analyzeProject(root); assert.equal(r.compatibility, 'WARNING'); assert.equal(r.features.routeHandlers.length, 1);
    await writeFile(path.join(root, 'app/data/route.ts'), 'export async function POST() { return new Response(); }');
    assert.equal((await analyzeProject(root)).compatibility, 'FAIL');
  });
});
test('src router, middleware/proxy and request-time APIs are detected', async () => {
  await project({ 'src/pages/index.tsx': 'export const getServerSideProps = async () => ({props:{}});', 'src/proxy.ts': 'export default function proxy() {}', 'app/data.ts': 'import { cookies as getCookies } from "next/headers";' }, async root => {
    const r = await analyzeProject(root); assert.equal(r.router, 'App + Pages Router'); assert.equal(r.strategy, 'REMOTE');
    assert.ok(r.issues.some(i => i.code === 'SERVER_RUNTIME')); assert.deepEqual(r.features.middleware, ['src/proxy.ts']);
  });
});
test('dynamic routes and native dependencies are reviewed', async () => {
  await project({ 'app/[slug]/page.tsx': 'export default function Page() {return null;}', 'package.json': '{"dependencies":{"next":"16.x","better-sqlite3":"12.x"}}' }, async root => {
    const r = await analyzeProject(root); assert.ok(r.issues.some(i => i.code === 'DYNAMIC_ROUTE_REVIEW')); assert.ok(r.issues.some(i => i.code === 'DEPENDENCY_REVIEW'));
  });
});
test('lockfile conflicts are explicit', async () => {
  await project({ 'yarn.lock': '', 'pnpm-lock.yaml': '' }, async root => {
    assert.ok((await analyzeProject(root)).issues.some(i => i.code === 'PACKAGE_MANAGER_CONFLICT'));
  });
});
test('missing and malformed package metadata fail without inventing Next.js', async () => {
  await project({ 'package.json': '{' }, async root => {
    assert.ok((await analyzeProject(root)).issues.some(i => i.code === 'PACKAGE_INVALID'));
    await rm(path.join(root, 'package.json'));
    const r = await analyzeProject(root); assert.equal(r.nextVersion, null); assert.equal(r.compatibility, 'FAIL');
  });
});
test('generated/dependency trees are excluded and private env values are hidden', async () => {
  await project({ 'node_modules/example/action.ts': '"use server";', '.next/action.js': '"use server";', '.env.local': 'SECRET_TOKEN=DO_NOT_LEAK', 'app/env.ts': 'const value = process.env["OTHER_SECRET"];' }, async root => {
    const r = await analyzeProject(root); assert.equal(r.features.serverActions.length, 0);
    assert.deepEqual(r.environmentVariables, ['OTHER_SECRET', 'SECRET_TOKEN']); assert.ok(!JSON.stringify(r).includes('DO_NOT_LEAK'));
  });
});
test('invalid project paths reject', async () => {
  await assert.rejects(analyzeProject(path.join(os.tmpdir(), 'next2apk-nonexistent', 'project')));
});
