export type Severity = 'warning' | 'error';
export interface Issue { code: string; severity: Severity; message: string; file?: string }
export interface AnalysisReport {
  schemaVersion: 1;
  root: string;
  nextVersion: string | null;
  router: 'App Router' | 'Pages Router' | 'App + Pages Router' | 'unknown';
  typescript: boolean;
  packageManager: string;
  configFiles: string[];
  environmentVariables: string[];
  supabase: boolean;
  features: { apiRoutes: string[]; routeHandlers: string[]; serverActions: string[]; middleware: string[] };
  compatibility: 'PASS' | 'WARNING' | 'FAIL';
  strategy: 'STATIC' | 'HYBRID' | 'REMOTE';
  issues: Issue[];
}
