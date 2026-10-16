# Architecture

## Increment 1: CLI and read-only analysis

`src/cli` owns arguments, exit codes and formatting. `src/analyzer` returns serializable reports and uses the TypeScript parser to inspect source without executing it. `src/doctor` probes local tools. `src/index.ts` exposes reusable APIs without CLI side effects. Tests exercise public analysis against fixtures and temporary projects.

Analysis is evidence, not proof of successful export. PASS means no known blockers were found. WARNING requires review. FAIL means a known blocker or invalid project. Every issue has a stable code, severity, explanation and optional relative file path. Environment values are never returned. Unreadable inputs fail explicitly; symlinks are skipped, with a warning, rather than followed outside the project. Generated directories and dependencies are excluded.

STATIC means a candidate for local web assets. HYBRID means an external backend is detected or moving API routes to a backend is necessary; it does not mean automatically convertible. REMOTE means a deployed Next.js runtime is needed unless the app is refactored. A remote WebView is not an offline conversion. Supabase browser usage can fit HYBRID; SSR integrations need review. Server Components alone are not blockers.

Configuration is never imported: that could execute arbitrary project code or require secrets. Literal hints are inspected conservatively and existing config always requires review. Imports and syntax are inspected, but dependency graphs, runtime branches, re-exports and custom tooling cannot be fully resolved in this MVP. The Next.js build remains the eventual compatibility gate.

## Planned increments

1. **Completed foundation:** CLI, analyzer, fixtures, tests, initial doctor.
2. **Capacitor:** reusable `capacitor/` adapter, typed initialization options (appId, appName, webDir), explicit package manager runner, version compatibility matrix. Produce an operation plan, back up existing files before edits, install matching Capacitor packages, create config, add Android and sync only after assets exist. Block unresolved analysis issues rather than silently rewriting server code.
3. **Android:** `android/` adapter for application ID, version, resources, icon/splash and explicit permissions. Validate names and paths; preserve existing native customizations. No broad permissions by default.
4. **Build:** `build/` orchestrator validates tool versions, runs Next export, verifies assets, syncs, invokes project Gradle wrapper, finds actual debug APK and copies to `dist/android/`. Handle cancellation, failures, paths with spaces, Windows command wrappers and stale artifacts. Never report success without a newly generated artifact.
5. **Extensions:** platform adapters for iOS/Tauri; separate signing, AAB, publishing and CI operations. UI and AI consume the same report/operation contracts. Signing secrets must not enter reports or logs.

`init` and `build` currently fail explicitly with exit code 2; no installation or project modification is performed. Bare `next2apk` analyzes the current directory. `doctor` checks availability only, not a complete Capacitor/Java/SDK version matrix. Gradle wrapper is preferred over global Gradle. No Android build is claimed by this increment.

## Technical risks

- A static scanner cannot prove runtime behavior; dynamic config, route generation, auth, image optimization and environment usage need review and a real export build.
- App Router GET handlers may be static; other HTTP methods and request-dependent handlers require a server. Dynamic routes need static parameters/paths.
- Public environment variables are embedded at build time; private variables can be valid during generation but must not be copied into the client.
- Monorepo/workspace package manager inheritance and custom page extensions are not fully resolved yet.
- Capacitor, Android SDK, JDK and Gradle compatibility changes over time. Pin and test a supported matrix in increment 2.

References: [Next.js static export](https://nextjs.org/docs/app/guides/static-exports), [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup).
