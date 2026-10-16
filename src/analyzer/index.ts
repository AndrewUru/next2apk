import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { AnalysisReport, Issue, Severity } from './types.js';

const excluded = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'coverage', 'android', 'ios', '.turbo']);
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function analyzeProject(input = process.cwd()): Promise<AnalysisReport> {
  const root = path.resolve(input);
  if (!(await stat(root)).isDirectory()) throw new Error('Project path must be a directory.');
  const issues: Issue[] = [];
  const add = (code: string, severity: Severity, message: string, file?: string): void => {
    if (!issues.some(i => i.code === code && i.file === file)) issues.push({ code, severity, message, ...(file ? { file } : {}) });
  };
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (excluded.has(entry.name)) continue;
      if (entry.isSymbolicLink()) { add('SYMLINK_SKIPPED', 'warning', 'Symbolic link was not inspected.', relative); continue; }
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await walk('');
  let pkg: Record<string, unknown> = {};
  if (!files.includes('package.json')) add('PACKAGE_MISSING', 'error', 'No package.json found at the project root.');
  else {
    try { pkg = record(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))); }
    catch { add('PACKAGE_INVALID', 'error', 'package.json is not valid readable JSON.', 'package.json'); }
  }
  const dependencies = { ...record(pkg.devDependencies), ...record(pkg.dependencies) };
  const nextVersion = typeof dependencies.next === 'string' ? dependencies.next : null;
  if (!nextVersion) add('NEXT_MISSING', 'error', 'Next.js is not declared in dependencies or devDependencies.', 'package.json');
  const hasApp = files.some(f => /^(src\/)?app\/(.*\/)?(page|layout)\.[jt]sx?$/.test(f));
  const hasPages = files.some(f => /^(src\/)?pages\/(?!api\/).*\.[jt]sx?$/.test(f));
  if (!hasApp && !hasPages) add('ROUTER_UNKNOWN', 'warning', 'No standard Next.js page files found. Check project root and custom pageExtensions.');
  const configFiles = files.filter(f => /^next\.config\.(js|mjs|ts|cjs|mts)$/.test(f));
  const lockManagers = [['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun']] as const;
  const managers = [...new Set(lockManagers.filter(([file]) => files.includes(file)).map(([, manager]) => manager))];
  const declaredManager = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : undefined;
  if (managers.length > 1 || (declaredManager && managers.some(m => m !== declaredManager))) add('PACKAGE_MANAGER_CONFLICT', 'warning', 'Conflicting package manager declarations or lockfiles.');
  const packageManager = declaredManager || managers[0] || 'unknown';
  const env = new Set<string>();
  const features: AnalysisReport['features'] = { apiRoutes: [], routeHandlers: [], serverActions: [], middleware: [] };
  let supabase = Object.keys(dependencies).some(d => d.startsWith('@supabase/'));
  let remote = false;
  let backend = false;
  for (const dependency of ['@prisma/client', 'prisma', 'better-sqlite3', 'sqlite3', 'pg', 'mysql2', 'sharp', 'next-auth', '@supabase/ssr']) {
    if (dependency in dependencies) add('DEPENDENCY_REVIEW', 'warning', `${dependency} may require Node.js, native binaries or server authentication; review its usage.`, 'package.json');
  }
  for (const file of files) {
    if (/(^|\/)\.env(?:\..*)?$/.test(file)) {
      const content = await readFile(path.join(root, file), 'utf8');
      for (const match of content.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) if (match[1]) env.add(match[1]);
      add('ENV_FILE_REVIEW', 'warning', 'Environment file detected; values are not included in the report.', file);
      continue;
    }
    if (!sourcePattern.test(file)) continue;
    const content = await readFile(path.join(root, file), 'utf8');
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    // Parse diagnostics are not part of SourceFile's public declaration.
    const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
    if (diagnostics?.length) add('SOURCE_PARSE_REVIEW', 'warning', 'Source could not be fully parsed; review manually.', file);
    const identifiers = new Set<string>();
    const exports = new Set<string>();
    let serverAction = false;
    let runtime = false;
    let standalone = false;
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node)) identifiers.add(node.text);
      if (ts.isSourceFile(node) || ts.isBlock(node)) {
        for (const statement of node.statements) {
          if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
          if (statement.expression.text === 'use server') serverAction = true;
        }
      }
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'dynamic' && node.initializer && ts.isStringLiteral(node.initializer) && node.initializer.text === 'force-dynamic') runtime = true;
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
        const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
        if (name === 'cache' && node.initializer.text === 'no-store') add('UNCACHED_FETCH_REVIEW', 'warning', 'Uncached data access detected; verify it can run during static generation.', file);
        if (name === 'output' && node.initializer.text === 'standalone') standalone = true;
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text;
        if (name.startsWith('@supabase/')) supabase = true;
        if (name === 'next/headers') runtime = true;
        if (name === 'next/image') add('IMAGE_OPTIMIZATION_REVIEW', 'warning', 'Default next/image optimization needs a server; verify unoptimized or an external loader.', file);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'process' && node.expression.name.text === 'env') env.add(node.name.text);
      if (ts.isElementAccessExpression(node) && node.expression.getText(source) === 'process.env' && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) env.add(node.argumentExpression.text);
      if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isFunctionDeclaration(node) && node.name) exports.add(node.name.text);
        if (ts.isVariableStatement(node)) for (const decl of node.declarationList.declarations) if (ts.isIdentifier(decl.name)) exports.add(decl.name.text);
      }
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) for (const e of node.exportClause.elements) exports.add(e.name.text);
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) add('REEXPORT_REVIEW', 'warning', 'Re-exported implementation is not resolved; review server behavior and route exports.', file);
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (identifiers.has('env') && identifiers.has('process')) add('ENV_USAGE_REVIEW', 'warning', 'Environment usage requires review, including build-time values and client exposure.', file);
    if (configFiles.includes(file)) {
      add('CONFIG_REVIEW', 'warning', 'Configuration was not executed. Verify export output, image settings, redirects, rewrites and dynamic configuration.', file);
      if (standalone) { remote = true; add('OUTPUT_STANDALONE', 'error', 'Standalone output requires a Node.js server; it is not static export.', file); }
    }
    if (/^(src\/)?pages\/api\/.*\.[jt]sx?$/.test(file)) {
      features.apiRoutes.push(file); backend = true;
      add('API_ROUTE', 'error', 'API route requires a backend. Move it to a deployed service before exporting the client.', file);
    }
    if (/^(src\/)?app\/(.*\/)?route\.[jt]s$/.test(file)) {
      features.routeHandlers.push(file);
      if (['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].some(m => exports.has(m)) || runtime) {
        backend = true;
        add('ROUTE_HANDLER_SERVER', 'error', 'Route Handler requires server execution.', file);
      } else add('ROUTE_HANDLER_REVIEW', 'warning', 'Verify GET handler can be generated at build time, uses force-static and does not depend on the incoming request.', file);
    }
    if (serverAction) {
      features.serverActions.push(file); remote = true;
      add('SERVER_ACTION', 'error', 'Server Action requires a deployed Next.js runtime or refactoring to an external API.', file);
    }
    if (/^(src\/)?(middleware|proxy)\.[jt]s$/.test(file)) {
      features.middleware.push(file); remote = true;
      add('MIDDLEWARE', 'error', 'Middleware/proxy requires a server and is unavailable in static export.', file);
    }
    if (runtime || exports.has('getServerSideProps')) {
      remote = true;
      add('SERVER_RUNTIME', 'error', 'Request-time APIs, SSR or uncached runtime data detected; requires a server or refactoring.', file);
    }
    if (/^(src\/)?(app|pages)\//.test(file) && file.includes('[') && /(?:page\.[jt]sx?$|^((src\/)?pages\/).*\.[jt]sx?$)/.test(file)) {
      add('DYNAMIC_ROUTE_REVIEW', 'warning', 'Dynamic route needs complete static parameters/paths and no runtime fallback; parent segment generators also require review.', file);
    }
    if (exports.has('revalidate') || exports.has('getInitialProps')) add('DATA_RENDERING_REVIEW', 'warning', 'Review revalidation or getInitialProps: runtime rendering and ISR are unavailable in static export.', file);
  }
  if (supabase) { backend = true; add('SUPABASE_REVIEW', 'warning', 'Supabase detected. Browser access may work with an external backend; review SSR auth, redirects and client keys.'); }
  const compatibility = issues.some(i => i.severity === 'error') ? 'FAIL' : issues.length ? 'WARNING' : 'PASS';
  return {
    schemaVersion: 1, root, nextVersion,
    router: hasApp && hasPages ? 'App + Pages Router' : hasApp ? 'App Router' : hasPages ? 'Pages Router' : 'unknown',
    typescript: files.includes('tsconfig.json') || files.some(f => /\.tsx?$/.test(f)),
    packageManager, configFiles, environmentVariables: [...env].sort(), supabase, features, compatibility,
    strategy: remote ? 'REMOTE' : backend ? 'HYBRID' : 'STATIC', issues,
  };
}
