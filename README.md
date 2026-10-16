
# next2apk

### Your Next.js project wants to be an Android app.

### It just doesn't know it yet.

![next2apk --- Turn your Next.js project into an Android
app](https://elsaltoweb.es/wp-content/uploads/2026/10/Convierte-Next.js-en-una-app-Android.webp)

**Analyze a Next.js project, figure out how much Android pain is hiding
inside it, and eventually turn the damn thing into an APK with as few
clicks as possible.**

[![License:
MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Tests](https://img.shields.io/badge/tests-43%20passing-brightgreen)
![Status](https://img.shields.io/badge/status-building%20the%20thing-orange)

**If this saves you from opening Android Studio even once, you legally
owe the repo a ⭐.**\
*Not legally. But spiritually? Absolutely.*
:::

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

  -----------------------------------------------------------------------
  Strategy                            Meaning
  ----------------------------------- -----------------------------------
  `STATIC`                            Congratulations. Life is good.

  `HYBRID`                            Some server-side stuff exists.
                                      We'll need to deal with it.

  `REMOTE`                            Your app needs a server. No amount
                                      of positive thinking will change
                                      that.
  -----------------------------------------------------------------------

No fake magic. No "AI converted your backend into Android somehow"
bullshit.

------------------------------------------------------------------------

## Current status

The analyzer and safe Capacitor initialization increments are implemented. APK compilation is still pending.

### Working

-   `next2apk analyze`
-   `next2apk doctor`
-   reusable project analyzer
-   text reports
-   JSON reports
-   `STATIC`, `HYBRID` and `REMOTE` strategy detection
-   App Router detection
-   Pages Router detection
-   API Route detection
-   Route Handler detection
-   Server Action detection
-   middleware detection
-   Supabase detection
-   environment variable analysis
-   package manager detection
-   TypeScript strict
-   test fixtures
-   **43 tests passing**

### Also working: Android preparation

-   `next2apk init`
-   Capacitor integration
-   safe project modification
-   backups
-   Android project generation

`init` prepares and synchronizes Android. It does **not** run Gradle or generate an APK.

### Not pretending to work yet

-   `next2apk build`
-   APK generation
-   APK signing
-   AAB
-   Google Play publishing
-   GUI
-   Tauri desktop app
-   iOS

If a command isn't implemented, next2apk tells you.

Revolutionary concept, apparently.

------------------------------------------------------------------------

## Try it

Clone the repository and install dependencies:

``` bash
git clone <YOUR-REPOSITORY-URL>
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

Capacitor core, CLI and Android are pinned to **8.5.3**, requiring Node >=22. TypeScript is added only if absent. Tests inject process runners and need no SDK. `next2apk build` remains a placeholder (exit 2); successful init does not certify APK compilation.

Public APIs: `planInit(path, options)`, `initializeProject(path, options, {run, log})`, `validateAppId()` and `generateConfig()`. See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries and limitations.

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
[██████████] Analyzer
[██████████] Doctor
[██████████] Init + Capacitor
[░░░░░░░░░░] Android build
[░░░░░░░░░░] APK output
[░░░░░░░░░░] Signing
[░░░░░░░░░░] AAB
[░░░░░░░░░░] GUI
[░░░░░░░░░░] One-click mode
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
:::
