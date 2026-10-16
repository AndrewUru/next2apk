# Architecture

## Increment 1: CLI and read-only analysis

`src/cli` owns arguments, exit codes and formatting. `src/analyzer` returns serializable reports and uses the TypeScript parser to inspect source without executing it. `src/doctor` probes local tools. `src/index.ts` exposes reusable APIs without CLI side effects. Tests exercise public analysis against fixtures and temporary projects.

Analysis is evidence, not proof of successful export. PASS means no known blockers were found. WARNING requires review. FAIL means a known blocker or invalid project. Every issue has a stable code, severity, explanation and optional relative file path. Environment values are never returned. Unreadable inputs fail explicitly; symlinks are skipped, with a warning, rather than followed outside the project. Generated directories and dependencies are excluded.

STATIC means a candidate for local web assets. HYBRID means an external backend is detected or moving API routes to a backend is necessary; it does not mean automatically convertible. REMOTE means a deployed Next.js runtime is needed unless the app is refactored. A remote WebView is not an offline conversion. Supabase browser usage can fit HYBRID; SSR integrations need review. Server Components alone are not blockers.

Configuration is never imported: that could execute arbitrary project code or require secrets. Literal hints are inspected conservatively and existing config always requires review. Imports and syntax are inspected, but dependency graphs, runtime branches, re-exports and custom tooling cannot be fully resolved in this MVP. The Next.js build remains the eventual compatibility gate.

## Planned increments

1. **Completed foundation:** CLI, analyzer, fixtures, tests, initial doctor.
2. **Completed initialization:** reusable `capacitor/` planner/orchestrator, validated appId/appName, package manager runner, backups and Android add/sync. Capacitor packages are pinned together at 8.5.3 (Node >=22). Android compilation/version checks remain a later increment.
3. **Android:** `android/` adapter for application ID, version, resources, icon/splash and explicit permissions. Validate names and paths; preserve existing native customizations. No broad permissions by default.
4. **Build:** `build/` orchestrator validates tool versions, runs Next export, verifies assets, syncs, invokes project Gradle wrapper, finds actual debug APK and copies to `dist/android/`. Handle cancellation, failures, paths with spaces, Windows command wrappers and stale artifacts. Never report success without a newly generated artifact.
5. **Extensions:** platform adapters for iOS/Tauri; separate signing, AAB, publishing and CI operations. UI and AI consume the same report/operation contracts. Signing secrets must not enter reports or logs.

`init` prepares Android; `build` now implements debug APK compilation. Bare `next2apk` still analyzes the current directory. `doctor` checks availability; build adds stricter SDK and JVM compatibility checks. There is no release/signing/publishing pipeline.

## Increment 2: initialization contracts

- `capacitor/config.ts`: pure validation and config serialization; names/URLs never enter shell commands.
- `capacitor/installer.ts`: npm/pnpm/yarn commands and injectable `ProcessRunner`; output streams directly to the terminal. Unknown/conflicting managers block execution rather than defaulting to npm. Existing TypeScript declarations are preserved; TypeScript is installed when missing because Capacitor loads a TS config.
- `capacitor/initializer.ts`: `planInit` reads only; `initializeProject` plans again, validates blockers, acquires a lock, backs up, installs, writes config, builds web assets where appropriate, adds/syncs Android and verifies generated files. A named step and the original error are propagated on failure.
- `project/next-config.ts`: edits property spans in plain exported object literals (ESM, CommonJS or a local const), preserving other text. Dynamic wrappers, functions, spreads and ambiguous settings are refused. Static output uses `distDir` when safely detectable, otherwise `out`; unsafe output paths are rejected. `trailingSlash` is enabled and detected next/image use gets unoptimized assets.
- `backup/journal.ts`: copies existing project files to a unique run directory before external tools, inventories SHA-256 changes after steps and atomically updates state. Existing state revisions are backed up too. The lock prevents cooperating init processes from running concurrently.
- `commands/init.ts`: prompts and plan presentation, with no Capacitor operations implemented inline in the CLI.

STATIC and HYBRID without known server blockers run the installed Next binary's build (not arbitrary package build scripts) to produce real assets before sync. The build is the compatibility gate. HYBRID with local API routes is blocked until backend extraction; Supabase/browser integrations retain remote infrastructure requirements. REMOTE requires an explicit HTTPS deployment URL, leaves Next configuration unchanged, and creates a minimal local shell in `.next2apk/remote-web`. The shell is not a static copy or offline replacement of the app. Capacitor documents `server.url` primarily for live reload; distribution/navigation/plugin security needs separate review.

Existing Capacitor configs stop initialization unless `--force` is explicit. Force backs up and replaces the TS config and archives conflicting JS/JSON configs, recording removed originals. Existing Android projects always block: regenerating them could change IDs or native customizations. Failure leaves backups and partial artifacts for inspection; there is no automatic rollback and retrying after native generation requires manual recovery.

The dry-run performs no writes, process launches, network calls or prompts. It lists planned config contents, backups, dependency commands, generated locations and blockers. Missing appId uses a clearly labelled preview example; real execution requires a supplied/interactive ID. Missing manager or REMOTE URL remains a blocker. Dependency/generated filenames cannot be known before running third-party tools: the plan names their affected locations and the journal captures actual changes.

Backups exclude `node_modules`, `.git` and internal `.next2apk` contents, apart from state and the remote shell that this tool overwrites. They include existing build output and may be large or contain secrets. `.next2apk/` is added to the project's `.gitignore`. Installation can execute dependency lifecycle hooks; Next build executes project code. This is not a sandbox, and arbitrary third-party effects outside the project are not recoverable through this journal. Workspace roots and symlinked project files are refused. No claims are made about restoring dependency caches, external side effects or validating all runtime navigation/authentication behavior.

## Increment 3: debug build

`build/pipeline.ts` validates the analyzer report, completed init state, literal Capacitor config, package manager and Android wrapper before exposing an operation plan. It reads config with TypeScript syntax parsing, not import/eval. Static Next output must still be export with the recorded webDir. A changed strategy requires review; REMOTE retains its stored HTTPS URL. `commands/build.ts` handles display only.

`environment/build.ts` reuses doctor probes and checks the SDK through `environment/sdk.ts`, also shared with doctor. `local.properties` takes priority over environment SDK paths. The selected package manager and installed Next/Capacitor packages are required, as are Java/javac, the requested SDK platform and build-tools. The Capacitor 8/AGP 8.13 default Build Tools is 35.0.0; explicit literal overrides are recognized. Wrapper files are mandatory and global Gradle is not used. JDK/Gradle minimum runtime versions are validated before build processes start. This is not a universal resolver of custom Gradle plugins/toolchains; project-specific Gradle errors still propagate.

`build/builder.ts` acquires the existing init lock only after environment validation. Next uses the existing package-manager command adapter; generated type scaffold changes to tsconfig.json/next-env.d.ts are restored to preserve original bytes. No source/signing/config rewriting is performed by the pipeline. External build tools execute trusted project code, not a sandbox. Public/exported/native .env filenames are rejected before packaging; NEXT_PUBLIC values remain intentionally public build inputs.

`build/gradle.ts` runs only the project wrapper, with assembleDebug, optional clean, rerun-tasks and plain output. SDK download is disabled. Output is streamed and bounded stdout/stderr tails are retained in the original Gradle error. No release signing configuration is touched. Gradle may download its own distribution and declared dependencies.

`build/artifacts.ts` inventories APK outputs before Gradle and selects exactly one fresh debug candidate afterward (fingerprint includes times, size and SHA-256). It verifies a nonempty ZIP header, copies exclusively, verifies the copy and publishes metadata last. This is not a full APK signature/device validation. Multiple APK candidates are refused. Failed publication removes its own partial copy. Existing artifacts are cleaned only when next2apk metadata, app ID, normalized filename, size and hash prove ownership; unrelated dist files remain untouched. A valid old publication is invalidated before a new build attempt to avoid stale success after failure. `--clean` additionally delegates native build-output cleanup to Gradle; it does not recursively delete arbitrary project paths.

The read-only dry-run performs no environment subprocess probes, mutation, cleaning or tool execution. It validates configuration and prints the steps that a real run will execute. It therefore cannot certify SDK/JDK availability. Every runtime error is wrapped with its step and original cause.

Automated verification uses temporary initialized project trees and injected process/environment adapters, with all 43 prior tests retained (the old build-placeholder assertion now checks a missing-init failure). The real STATIC attempt in this environment was blocked by absent Android SDK and Java 25 vs Gradle 8.14.3; no SDK/JDK installation or real APK success is claimed.

References: [Android command-line builds](https://developer.android.com/build/building-cmdline), [Gradle JVM compatibility](https://docs.gradle.org/current/userguide/compatibility.html), [AGP 8.13 requirements](https://developer.android.com/build/releases/agp-8-13-0-release-notes).

## Remaining technical risks

- A static scanner cannot prove runtime behavior; dynamic config, route generation, auth, image optimization and environment usage need review and a real export build.
- App Router GET handlers may be static; other HTTP methods and request-dependent handlers require a server. Dynamic routes need static parameters/paths.
- Public environment variables are embedded at build time; private variables can be valid during generation but must not be copied into the client.
- Monorepo/workspace package manager inheritance and custom page extensions are not fully resolved yet.
- Capacitor, Android SDK, JDK and Gradle compatibility changes over time. Pin and test a supported matrix in increment 2.

References: [Next.js static export](https://nextjs.org/docs/app/guides/static-exports), [Capacitor setup](https://capacitorjs.com/docs/getting-started/environment-setup).
