
# next2apk

### Your Next.js project wants to be an Android app.

### It just doesn't know it yet.

![next2apk --- Turn your Next.js project into an Android
app](https://elsaltoweb.es/wp-content/uploads/2026/10/Convierte-Next.js-en-una-app-Android.webp)

**Analyze a Next.js project, figure out how much Android pain is hiding
inside it, and eventually turn the damn thing into an APK with as few
clicks as possible.**

[![CI](https://github.com/AndrewUru/next2apk/actions/workflows/ci.yml/badge.svg)](https://github.com/AndrewUru/next2apk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Status](https://img.shields.io/badge/status-early%20but%20builds%20real%20APKs-orange)

**If this saves you from opening Android Studio even once, you legally
owe the repo a ⭐.**\
*Not legally. But spiritually? Absolutely.*

------------------------------------------------------------------------

## What the hell is next2apk?

You built a project in Next.js.

It works.

It looks good.

Someone asks:

> "Can we have it as an Android app?"

And suddenly you're reading about Gradle, Android SDKs, Capacitor,
signing keys, manifests, static exports, server components, Java
versions and seventeen different ways to ruin an otherwise perfectly
good afternoon.

**next2apk exists to make that somebody else's problem.**

Ideally:

``` bash
npx next2apk
```

Then:

``` text
✓ Analyzing project...
✓ Figuring out what weird shit you're doing...
✓ Configuring Android...
✓ Building...
✓ Questioning several architectural decisions...
✓ Done.

dist/android/your-app.apk
```

We're not quite there yet.

But that's the destination.

------------------------------------------------------------------------

## The idea

``` text
┌─────────────────┐
│                 │
│  Next.js app    │
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│                 │
│    next2apk     │
│                 │
│  analyze        │
│  configure      │
│  Capacitor      │
│  Android        │
│  Gradle         │
│                 │
└────────┬────────┘
         │
         ▼
     ┌───────┐
     │  APK  │
     └───────┘

   everybody goes home
```

The goal is not to pretend every Next.js project is magically a static
website.

Because it isn't.

next2apk analyzes the project first and determines what we're dealing
with.

| Strategy | Meaning |
|---|---|
| `STATIC` | Congratulations. Life is good. |
| `HYBRID` | Some server-side stuff exists. We'll need to deal with it. |
| `REMOTE` | Your app needs a server. No amount of positive thinking will change that. |

No fake magic. No "AI converted your backend into Android somehow"
bullshit.

------------------------------------------------------------------------

## Current status

next2apk is early, but the core path works end to end: **analyze → init → build → a real debug APK**.

| Command | What it does | State |
|---|---|---|
| `analyze` | Read-only report and `STATIC` / `HYBRID` / `REMOTE` strategy | Working |
| `doctor` | Checks Node, package managers, JDK, Android SDK, Gradle | Working |
| `init` | Adds Capacitor and generates the Android project, with backups and `--dry-run` | Working |
| `build` | Runs the Next.js build, syncs Capacitor and compiles a **debug** APK | Working |

### What has actually been verified

-   A real debug APK is generated from the included `fixtures/static-next` project, on Windows 11 (local) and on Ubuntu (GitHub Actions, run weekly and on demand: [`apk.yml`](.github/workflows/apk.yml)).
-   The automated test suite runs on Windows and Linux, with Node 22 and 24, on every push ([`ci.yml`](.github/workflows/ci.yml)). It needs no Android SDK: external tools are replaced by injected runners.
-   The generated APK is checked to exist, to be a non-empty ZIP and to be newly built. **It has not been installed or run on a device or emulator yet.**

### What is detected

-   App Router and Pages Router
-   API Routes, Route Handlers, Server Actions and middleware
-   Supabase and environment variable usage
-   package manager (npm, pnpm, yarn)
-   the reasons a project cannot be a self-contained app, before anything is touched

### Not pretending to work yet

-   APK signing and release builds (**only debug APKs**)
-   AAB
-   Google Play publishing
-   GUI
-   Tauri desktop app
-   iOS
-   monorepos / workspace roots (refused on purpose)
-   projects beyond the included fixtures: only `static-next` has been built end to end

If a command isn't implemented, next2apk tells you.

Revolutionary concept, apparently.

------------------------------------------------------------------------

## Try it

### Requirements

-   **Node.js 22 or newer.**
-   **For `analyze` and `doctor`: nothing else.**
-   **To build an APK** (`build`): a JDK and the Android SDK. next2apk never installs them for you.
    -   JDK **21** is recommended. Newer JDKs only work if the project's Gradle wrapper supports them (Java 25 does not work with the Gradle 8.14 that Capacitor 8 ships with).
    -   Android SDK **platform 36** and **Build Tools 35.0.0** (that exact version: Android's Gradle plugin selects it, and a newer one does not substitute for it):

``` bash
sdkmanager "platforms;android-36" "build-tools;35.0.0"
```

You don't need to set `ANDROID_HOME` or `JAVA_HOME` if you use Android Studio. When they are missing, next2apk looks for Android Studio's SDK in its default location and for Android Studio's bundled JDK, uses them only for Gradle, and tells you it did. If you set `JAVA_HOME` yourself, it is always respected and never replaced.

### Install and analyze

Clone the repository and install dependencies:

``` bash
git clone https://github.com/AndrewUru/next2apk.git
cd next2apk
npm install
npm run build
```

Analyze one of the included fixtures:

``` bash
node dist/cli/index.js analyze fixtures/static-next
```

Analyze your own questionable life choices:

``` bash
node dist/cli/index.js analyze /path/to/your/next-project
```

Want JSON because you're a civilized person?

``` bash
node dist/cli/index.js analyze /path/to/your/project --json
```

Check whether your machine is ready for Android-related suffering:

``` bash
node dist/cli/index.js doctor
```

### From project to APK

Work on a **copy** of your project the first time: `init` modifies it (it makes backups, but still).

``` bash
node dist/cli/index.js init  ./my-app --dry-run                 # see exactly what would happen
node dist/cli/index.js init  ./my-app --app-name "My App" --app-id com.example.myapp
node dist/cli/index.js build ./my-app                           # -> ./my-app/dist/android/my-app-debug.apk
```

The result is a **debug** APK for testing, not something you can publish.

------------------------------------------------------------------------

## Example

### Initialize safely

```bash
node dist/cli/index.js init ./my-app --dry-run
node dist/cli/index.js init ./my-app --app-name "My App" --app-id com.example.myapp
```

In an interactive terminal, missing application details are requested. Without a terminal, pass `--app-id`; the display name defaults to the directory name. npm, pnpm and yarn are selected from the analyzer. If no manager is detectable, supply `--package-manager npm|pnpm|yarn`. Conflicting declarations must be resolved first.

STATIC and exportable HYBRID projects get a static Next configuration, a real `next build`, Capacitor configuration and Android add/sync. A custom literal `distDir` becomes `webDir`; `out` is the default. Dynamic Next configuration is refused rather than rewritten. HYBRID with local server routes must extract its backend first. Supabase hosting/authentication remains external.

REMOTE projects require a deployed HTTPS website:

```bash
node dist/cli/index.js init ./server-app --app-id com.example.remote --remote-url https://app.example.com --package-manager npm
```

REMOTE leaves Next.js unchanged and configures `server.url`; a local shell is created in `.next2apk/remote-web`. The app needs that server and a connection. Capacitor documents this URL setting primarily for live reload: review remote navigation and native plugin security before distribution.

`--dry-run` prints configuration previews, commands, backups, generated paths and blockers without writing anything or running external tools. A missing ID is shown as a preview example only; unknown manager or missing remote URL blocks execution. External tools determine exact generated/dependency filenames at execution time.

Existing Capacitor configuration stops init. `--force` backs it up before replacing it; conflicting JS/JSON originals are archived so Capacitor cannot load the wrong file. An existing `android/` always stops init, even with force, to preserve native customizations.

Each run records `.next2apk/state.json` with version, date, strategy, configuration, created/modified/removed files, backup locations, current step and failure status. Backups live in `.next2apk/backups/<run>/`. Existing project files are backed up before external tools, excluding dependencies, Git and internal journal files (previous state and remote shell are backed up separately). `.next2apk/` is added to `.gitignore`; backups can contain secrets and large build directories.

On failure the original tool output remains visible and the error identifies the step. Partial changes and backups remain for inspection; there is no automatic rollback. Package lifecycle scripts and Next build execute project code, so their arbitrary external effects are outside the backup guarantee. Workspace roots and symlinked project files are not supported in this increment.

Capacitor core, CLI and Android are installed with an exact version (`--save-exact`) of **8.5.3**, requiring Node >=22, so a later `npm install` cannot drift to an untested release. TypeScript is added (also exact) only if absent. In TypeScript projects that declare `react` but not `@types/react`, init also adds `@types/react` at React's major version, as a range, because Next.js only installs it by itself outside CI. Tests inject process runners and need no SDK. Successful init does not certify APK compilation: build validates the environment separately.

Public APIs: `planInit(path, options)`, `initializeProject(path, options, {run, log})`, `validateAppId()` and `generateConfig()`. See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries and limitations.

### Build a debug APK

```bash
next2apk build ./my-app --dry-run
next2apk build ./my-app
next2apk build ./my-app --clean
```

Omit the path to use the current directory. `build` requires a completed `.next2apk/state.json`, matching literal `capacitor.config.ts`, an Android project with its Gradle Wrapper and a compatible environment. It never substitutes for `init`, converts server code, edits signing configuration or installs an SDK.

Preflight re-analyzes the project and checks strategy/configuration drift. STATIC and eligible HYBRID projects run their installed Next binary through npm/pnpm/yarn, validate `webDir/index.html`, sync Capacitor and invoke `gradlew.bat` on Windows or `./gradlew` on Unix. REMOTE reuses the stored HTTPS URL and local shell, skipping Next build. HYBRID and REMOTE still require their external infrastructure. Arbitrary package.json scripts are not selected.

Environment validation reuses doctor and additionally checks SDK platform/build-tools and Java/Gradle compatibility, before any build command starts. Requirements are listed under [Try it](#requirements). Resolution order:

-   **JDK:** an explicit `JAVA_HOME` is always used as is and never replaced. Otherwise the JDK on `PATH` is used if the project's Gradle wrapper supports it; if not, Android Studio's bundled JDK is used when it is compatible. The substitution only affects the Gradle process, and is announced in the output.
-   **SDK:** `android/local.properties`, then `ANDROID_HOME`/`ANDROID_SDK_ROOT`, then Android Studio's default location (`%LOCALAPPDATA%\Android\Sdk`, `~/Library/Android/sdk` or `~/Android/Sdk`). A default-location SDK is handed to Gradle as `ANDROID_HOME`.
-   **Build Tools:** the exact version Android's Gradle plugin selects (35.0.0 for init's Capacitor 8 template, or an explicit literal `buildToolsVersion`). A missing one fails with the `sdkmanager` command to install it.

No global Gradle is needed. The wrapper can download its Gradle distribution and Gradle dependencies, but SDK auto-download is disabled.

Only `assembleDebug` is supported. A new, nonempty debug APK must be found under Android's APK output tree; unchanged old files, multiple candidates and non-ZIP files are rejected. The verified result is copied to:

```text
dist/android/<normalized-app-name>-debug.apk
dist/android/build.json
```

Metadata contains app identity, strategy, creation time, size and SHA-256, with an ownership marker for safe cleanup. It contains no environment values or remote credentials. Existing unknown/tampered destination files are protected. Before a real rebuild, only a previously hash-verified next2apk artifact and metadata are invalidated, so failed attempts cannot advertise an old APK as a new result. `--clean` also requests Gradle's native `clean` task; it never deletes `android/` or unrelated files in `dist/`.

`--dry-run` checks project/state/configuration read-only and displays the pipeline; it does not probe tools, run Next/Capacitor/Gradle, create `dist/`, clean files or prove that the machine can compile. Missing initialization still blocks the plan. Runtime failures report the exact step and retain original tool diagnostics. Build exits 1 on errors and 0 on successful publication/valid dry-run.

**DEBUG APK != RELEASE APK.** Debug uses Android's standard development signing and is intended for testing. Release signing, keystore management, AAB and Play Store deployment are not implemented. Custom native paths, split APKs/flavors, dynamic Capacitor configs and `webDir: 'dist'` (which collides with artifact publication) are deliberately rejected in this increment.

The automated tests require no SDK. A real STATIC build of `fixtures/static-next` has been run on Windows 11 and, in CI, on Ubuntu, producing a ~4 MB debug APK. **The APK has not been installed on a device or emulator yet**, and only that one fixture has been built end to end: expect rough edges on real projects, and please open an issue when you hit one. next2apk never installs or modifies your SDK or JDK.

### Analyze

``` text
next2apk analyze ./my-app

Project
────────────────────────────
Next.js          detected
Router           App Router
TypeScript       yes
Supabase         detected

Compatibility
────────────────────────────
Static export    FAIL
Server Actions   2 detected
API Routes       none
Middleware       none

Recommended strategy:

REMOTE
```

The important part is that next2apk should tell you **why** your project
can or cannot become a self-contained Android application.

Before touching anything.

Because tools that rewrite your project first and explain themselves
later deserve jail.

------------------------------------------------------------------------

## Why not just use Capacitor?

You absolutely can.

Capacitor is excellent.

next2apk isn't trying to replace it.

The annoying part is everything around it:

``` text
Is this Next.js app statically exportable?
Does it use Server Actions?
What happens to API Routes?
Where does the backend live?
Which env vars are safe?
What should webDir be?
Is Android configured?
Where the fuck is ANDROID_HOME?
Why is Gradle angry?
Why is Java angry?
Why am I angry?
```

next2apk aims to sit between:

``` text
“I have a Next.js project”
```

and:

``` text
“I have an Android app”
```

while keeping the number of Stack Overflow tabs below medically
concerning levels.

------------------------------------------------------------------------

# We need contributors

This project is intentionally being built in small increments.

That means **right now is actually a useful time to contribute**.

Not when there are 80,000 lines of code, three abandoned rewrites and an
issue from 2027 saying:

> "Is this project still maintained?"

If you know any of this stuff:

-   Next.js internals
-   static export
-   Capacitor
-   Android
-   Gradle
-   Java/Kotlin
-   AST analysis
-   package managers
-   CLI design
-   testing
-   CI/CD
-   ways developers create cursed Next.js architectures we haven't
    detected yet

...come break things.

Then preferably fix them.

------------------------------------------------------------------------

## How to contribute without starting a civil war

1.  Fork the repo.
2.  Create a branch.
3.  Make one understandable change.
4.  Add tests when it makes sense.
5.  Don't format the entire codebase because your editor felt creative.
6.  Open a PR.
7.  Explain what you changed like you're talking to another human being.

``` bash
git checkout -b feat/your-actually-useful-thing
npm test            # needs no Android SDK; CI runs it on Windows and Linux
npm run typecheck
```

Commit messages such as:

``` text
feat: add pnpm detection
fix: detect route handlers in nested app routes
test: add server action fixture
```

are appreciated.

Commit messages such as:

``` text
stuff
fix
final
final-final
final-final-2
asdfgh
```

will cause mild emotional damage.

------------------------------------------------------------------------

## Found a bug?

Good.

Seriously.

Open an issue and include:

``` text
OS:
Node version:
Next.js version:
Package manager:
Command:
Expected:
Actual:
Relevant project structure:
```

If possible, provide a minimal reproduction.

If your bug report is:

> "doesn't work"

we will perform an ancient debugging ritual consisting of staring at the
issue until additional information materializes.

Results may vary.

------------------------------------------------------------------------

## Want to add a feature?

Open an issue first for large changes.

The north star is simple:

> **Turn a Next.js project into an Android app with the least possible
> bullshit.**

A feature probably belongs here if it makes that journey:

-   safer
-   clearer
-   faster
-   more automatic
-   less dependent on Android Studio
-   less likely to make someone throw their laptop through a window

------------------------------------------------------------------------

## Architecture principle

The CLI is just an interface.

Core functionality should remain reusable so we can eventually have:

``` text
CLI
 │
 ├── Project Analyzer
 ├── Compatibility Engine
 ├── Capacitor Adapter
 ├── Android Builder
 └── Artifact Manager
        │
        ├── APK
        └── AAB

Later:

Desktop GUI ───────────────┘
CI/CD ────────────────────┘
Your ridiculous idea ─────┘
```

Please don't bury important logic inside CLI prompts.

Future us already has enough problems.

------------------------------------------------------------------------

## Roadmap

``` text
Done
  [x] Analyzer and strategy detection
  [x] Doctor
  [x] Init + Capacitor (backups, dry-run, exact versions)
  [x] Debug APK pipeline, verified on Windows and Linux CI with one fixture
  [x] APK output and metadata
  [x] CI: tests on Windows/Linux, weekly real APK build

Next (making it trustworthy)
  [ ] Build real-world Next.js apps, not just fixtures (Supabase, API routes, i18n...)
  [ ] Install and run the APK on an emulator in CI
  [ ] Monorepo / workspace support

Later
  [ ] Release signing
  [ ] AAB
  [ ] GUI
  [ ] One-click mode
```

Ultimate goal:

``` bash
npx next2apk
```

followed by suspiciously little drama.

------------------------------------------------------------------------

# ⭐ About that star

Look.

GitHub stars don't pay the bills.

They don't compile Gradle.

They don't fix dependency conflicts.

They don't even make `ANDROID_HOME` configure itself.

But they make a tiny number go up, and apparently that's enough dopamine
to maintain open-source software at 2:13 in the morning.

So if you:

-   like the idea,
-   want to use it someday,
-   enjoy watching developers fight build systems,
-   arrived here accidentally,
-   or have simply read this far and now feel trapped...

**hit the damn ⭐ button.**

It costs nothing.

I checked.

And if you don't star it after next2apk eventually saves you three hours
of Android configuration...

``` text
next2apk remembers.
```

Probably.

We haven't implemented telemetry.

**And we're not going to.**

------------------------------------------------------------------------

## License

MIT.

Use it. Fork it. Improve it. Build weird things with it.

Just don't sell a \$499 course called:

> **"My secret system for converting Next.js to Android"**

three days after cloning the repo.

Or do.

But at least leave the fucking star.

------------------------------------------------------------------------


### Next.js → next2apk → Android

**Less configuration. Fewer rituals. More APK.**

⭐ **Star it before Gradle notices we're having fun.** ⭐
