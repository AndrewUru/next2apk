# next2apk

CLI open source en Node.js y TypeScript para analizar proyectos Next.js antes de preparar una aplicación Android con Capacitor.

**Estado: primer incremento (CLI y analyzer). Todavía no genera APKs.** `init` y `build` están registrados, pero terminan con un mensaje explícito de funcionalidad pendiente y código 2. No instalan dependencias ni cambian el proyecto analizado.

## Desarrollo y uso local

Requisitos: Node.js >=22 y npm.

```sh
npm ci
npm run build
node dist/cli/index.js analyze ./fixtures/static-next
node dist/cli/index.js analyze /ruta/al/proyecto --json
node dist/cli/index.js doctor
npm test
```

Para probar el comando localmente:

```sh
npm link
next2apk analyze /ruta/al/proyecto
next2apk analyze
next2apk
next2apk doctor
next2apk init /ruta/al/proyecto
next2apk build /ruta/al/proyecto
```

Sin path, se utiliza el directorio actual. `next2apk` sin argumentos equivale a `analyze`. Usa comillas si la ruta contiene espacios. `npm link` registra el ejecutable local en el entorno de npm.

La experiencia futura será `npx next2apk`, una vez publicado y completado el flujo. Este repositorio no se ha publicado en npm; ese comando podría resolver un paquete ajeno. Para inspeccionar el paquete local: `npm pack --dry-run`.

## Informe

```text
Next.js       16.x (declared version)
Router        App Router
TypeScript    yes
Package mgr   npm
Config        none
Supabase      not detected
Environment   none detected

Static export compatibility:
PASS

Issues:
- No known blockers detected.

Recommended strategy:
STATIC
```

- `PASS`: no se han encontrado bloqueos conocidos; no garantiza exportación ni compilación.
- `WARNING`: hay cuestiones que requieren revisión.
- `FAIL`: se ha encontrado un bloqueo o el proyecto no es válido.

`STATIC` propone assets locales. `HYBRID` requiere un backend externo y puede exigir extraer las API Routes. `REMOTE` requiere desplegar Next.js o refactorizar las funciones de servidor. En un proyecto inválido, la estrategia no es utilizable: hay que resolver primero los errores del informe.

El analyzer detecta versión declarada de Next.js, App/Pages Router (incluido `src/`), TypeScript, config, package manager, nombres de variables de entorno, API Routes, Route Handlers, Server Actions, middleware/proxy, Supabase y dependencias que necesitan revisión. No ejecuta código del proyecto. No devuelve valores de entorno.

Los Server Components pueden generarse estáticamente. Los GET Route Handlers se marcan para revisión; los métodos que necesitan backend bloquean la exportación. Las rutas dinámicas requieren verificar sus parámetros estáticos. Un archivo de configuración existente siempre requiere revisión porque no se evalúa.

Limitaciones: análisis sintáctico conservador sin resolución completa de imports, dependencias o ejecución. No interpreta configuraciones dinámicas ni demuestra qué código se ejecutará. Puede detectar uso de servidor en archivos no alcanzables. No resuelve completamente monorepos ni extensiones personalizadas de páginas. Las fixtures son muestras mínimas para el scanner, no aplicaciones certificadas mediante un build Next.js. La comprobación definitiva será una exportación real en el incremento de build.

## Doctor

Comprueba Node, npm/pnpm/yarn, Java, directorios del Android SDK, Gradle wrapper/global y paquetes Capacitor accesibles desde el directorio actual. Las herramientas alternativas o pendientes de inicialización producen advertencias; Java/SDK ausentes producen errores. Es un diagnóstico inicial de disponibilidad: todavía no valida la matriz de versiones, licencias SDK ni ejecuta el wrapper del proyecto.

Códigos de salida: `0` análisis sin errores (puede tener advertencias), `1` error de análisis/ejecución o requisito esencial de doctor ausente, `2` comando de una fase pendiente.

## Arquitectura y API

```text
src/
  analyzer/       # Detección, reglas y contrato serializable
  cli/            # Argumentos, presentación y códigos de salida
  doctor/         # Diagnóstico del entorno
  index.ts        # API pública sin efectos de CLI
tests/
fixtures/
  static-next/
  supabase-next/
  server-actions-next/
  api-routes-next/
```

```ts
import { analyzeProject } from 'next2apk';
const report = await analyzeProject('/ruta/al/proyecto');
console.log(report.compatibility, report.strategy, report.issues);
```

Consulta [ARCHITECTURE.md](ARCHITECTURE.md) para decisiones, riesgos y próximos incrementos: configuración segura de Capacitor con backups, recursos Android, build con Gradle y copia del APK a `dist/android/`. AAB, signing, Google Play, iOS, Tauri, GUI, CI/CD y análisis asistido por IA se incorporarán mediante módulos independientes.

## Contribuir

Antes de enviar cambios: `npm run typecheck`, `npm test` y `npm run build`. Añade una fixture o una prueba cuando cambies una regla de compatibilidad. Ninguna regla debe prometer que código dependiente de servidor puede ejecutarse dentro de un APK estático.

Licencia MIT.
