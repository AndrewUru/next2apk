export interface AppConfiguration {
  appId: string;
  appName: string;
  webDir: string;
  server?: { url: string };
}

const javaKeywords = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' '));
export function validateAppId(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value) || value.split('.').some(part => javaKeywords.has(part))) {
    throw new Error('Invalid appId. Use at least two dot-separated Java identifiers starting with a letter, e.g. com.example.myapp; no spaces, hyphens or Java keywords.');
  }
}
export function validateRemoteUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Remote URL must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Remote URL must use HTTPS without credentials, query parameters or fragments.');
  return url.href;
}
export function generateConfig(config: AppConfiguration): string {
  validateAppId(config.appId);
  if (!config.appName.trim() || /[\x00-\x1f]/.test(config.appName)) throw new Error('appName must be nonempty and contain no control characters.');
  if (config.server) validateRemoteUrl(config.server.url);
  return `import type { CapacitorConfig } from '@capacitor/cli';\n\nconst config: CapacitorConfig = ${JSON.stringify(config, null, 2)};\n\nexport default config;\n`;
}
