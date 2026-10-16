import ts from 'typescript';

export interface NextConfigEdit { content: string; webDir: string; originalOutput?: string }
function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
export function prepareNextConfig(content?: string, file = 'next.config.mjs', unoptimized = false): NextConfigEdit {
  if (content === undefined) return { content: `export default {\n  output: 'export',\n  trailingSlash: true,${unoptimized ? '\n  images: { unoptimized: true },' : ''}\n};\n`, webDir: 'out' };
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const variables = new Map<string, ts.Expression>();
  let exported: ts.Expression | undefined;
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
      for (const decl of statement.declarationList.declarations) if (ts.isIdentifier(decl.name) && decl.initializer) variables.set(decl.name.text, decl.initializer);
    } else if (ts.isExportAssignment(statement)) exported = statement.expression;
    else if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.left.getText(source) === 'module.exports' && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) exported = statement.expression.right;
    else if (!ts.isImportDeclaration(statement) && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement) && !ts.isEmptyStatement(statement)) throw new Error('Next config contains executable statements; configure static export manually before init.');
  }
  if (exported && ts.isIdentifier(unwrap(exported))) exported = variables.get((unwrap(exported) as ts.Identifier).text);
  if (!exported || !ts.isObjectLiteralExpression(unwrap(exported))) throw new Error('Cannot safely edit dynamic Next config. Use a plain exported object for init; wrappers/functions are not rewritten.');
  const object = unwrap(exported) as ts.ObjectLiteralExpression;
  const props = new Map<string, ts.PropertyAssignment>();
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop) || (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name))) throw new Error('Next config spreads, methods and computed properties require manual review.');
    if (props.has(prop.name.text)) throw new Error('Duplicate Next config properties require manual review.');
    props.set(prop.name.text, prop);
  }
  for (const key of ['redirects', 'rewrites', 'headers', 'i18n', 'exportPathMap', 'basePath', 'assetPrefix', 'pageExtensions']) {
    if (props.has(key)) throw new Error(`Next config property ${key} requires manual review before Android static export.`);
  }
  const dist = props.get('distDir');
  if (dist && !ts.isStringLiteral(dist.initializer)) throw new Error('distDir must be a literal string for safe webDir detection.');
  const webDir = dist && ts.isStringLiteral(dist.initializer) && dist.initializer.text !== '.next' ? dist.initializer.text : 'out';
  if (!/^[A-Za-z0-9_-]+$/.test(webDir) || ['src', 'app', 'pages', 'public', 'static', 'android', 'ios', 'node_modules'].includes(webDir)) throw new Error(`Unsafe export directory ${webDir}. Choose a dedicated top-level output directory.`);
  const edits: { start: number; end: number; text: string }[] = [];
  const additions: string[] = [];
  function set(name: string, value: string): void {
    const prop = props.get(name);
    if (prop) edits.push({ start: prop.initializer.getStart(source), end: prop.initializer.end, text: value });
    else additions.push(`${name}: ${value}`);
  }
  set('output', "'export'");
  set('trailingSlash', 'true');
  if (unoptimized) {
    const images = props.get('images');
    if (images) {
      if (!ts.isObjectLiteralExpression(images.initializer)) throw new Error('Dynamic images configuration requires manual unoptimized configuration.');
      const imageObject = images.initializer;
      const existing = imageObject.properties.find(p => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'unoptimized');
      if (existing && ts.isPropertyAssignment(existing)) edits.push({ start: existing.initializer.getStart(source), end: existing.initializer.end, text: 'true' });
      else edits.push({ start: imageObject.end - 1, end: imageObject.end - 1, text: `${imageObject.properties.length && !imageObject.properties.hasTrailingComma ? ',' : ''} unoptimized: true ` });
    } else additions.push('images: { unoptimized: true }');
  }
  if (additions.length) edits.push({ start: object.end - 1, end: object.end - 1, text: `${object.properties.length && !object.properties.hasTrailingComma ? ',' : ''}\n  ${additions.join(',\n  ')}\n` });
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
  const output = props.get('output')?.initializer;
  return { content, webDir, ...(output && ts.isStringLiteral(output) ? { originalOutput: output.text } : {}) };
}
