import type { AnalysisReport } from '../analyzer/types.js';
export function formatReport(report: AnalysisReport): string {
  return [
    `Next.js       ${report.nextVersion ?? 'not detected'} (declared version)`,
    `Router        ${report.router}`,
    `TypeScript    ${report.typescript ? 'yes' : 'no'}`,
    `Package mgr   ${report.packageManager}`,
    `Config        ${report.configFiles.join(', ') || 'none'}`,
    `Supabase      ${report.supabase ? 'detected' : 'not detected'}`,
    `Environment   ${report.environmentVariables.join(', ') || 'none detected'}`,
    '', 'Static export compatibility:', report.compatibility,
    '', 'Issues:', ...report.issues.map(i => `- [${i.severity.toUpperCase()}] ${i.code}: ${i.message}${i.file ? ` (${i.file})` : ''}`),
    ...(report.issues.length ? [] : ['- No known blockers detected.']),
    '', 'Recommended strategy:', report.strategy,
    '', 'Static analysis only. PASS is not proof of export/build success.',
    ...(report.strategy === 'STATIC' ? [] : ['An external server/backend is required unless the application is refactored.']),
  ].join('\n');
}
