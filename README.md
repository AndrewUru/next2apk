
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
![Tests](https://img.shields.io/badge/tests-18%20passing-brightgreen)
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

The first increment is alive.

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
-   **18 tests passing**

### Currently being built

-   `next2apk init`
-   Capacitor integration
-   safe project modification
-   backups
-   Android project generation

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
Static export    warning
Server Actions   2 detected
API Routes       none
Middleware       none

Recommended strategy:

HYBRID
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
[░░░░░░░░░░] Init + Capacitor
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
