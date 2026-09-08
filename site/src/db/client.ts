// Database client: Drizzle + libSQL (Turso), HTTP driver.
//
// Runs on the Cloudflare Workers runtime (@libsql/client/web only, no native
// bindings) and in Node for scripts. Env resolution order:
//   1. configureTursoFromRuntime(Astro.locals.runtime.env) — Cloudflare Pages
//      secrets (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN) per request
//   2. import.meta.env / process.env — from .env or build-time env
//   3. Throws on first use with setup guidance (so the app still boots).
//
// Local scripts (npm run db:push / db:seed) use the same client: point
// TURSO_DATABASE_URL at your Turso project or a local libsql server
// (e.g. http://127.0.0.1:8080).
import { createClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql';

let url =
  (typeof process !== 'undefined' ? process.env.TURSO_DATABASE_URL : undefined) ??
  import.meta.env?.TURSO_DATABASE_URL ??
  '';
let authToken =
  (typeof process !== 'undefined' ? process.env.TURSO_AUTH_TOKEN : undefined) ??
  import.meta.env?.TURSO_AUTH_TOKEN ??
  '';

export function configureTurso(dbUrl: string, token?: string) {
  url = dbUrl;
  authToken = token ?? '';
}

/** Read Turso settings from the Cloudflare runtime bindings (Pages secrets). */
export function configureTursoFromRuntime(runtimeEnv?: Record<string, unknown> | null) {
  const v = runtimeEnv as Record<string, unknown> | undefined;
  if (v?.TURSO_DATABASE_URL) {
    configureTurso(String(v.TURSO_DATABASE_URL), v.TURSO_AUTH_TOKEN ? String(v.TURSO_AUTH_TOKEN) : undefined);
  }
}

type DB = ReturnType<typeof buildDb>;
let _db: DB | undefined;

function buildDb(): DB {
  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. Add it to site/.env (npm run db:push / db:seed) or to Cloudflare Pages secrets (runtime).'
    );
  }
  return drizzle(createClient({ url, authToken: authToken || undefined }));
}

export function getDb(): DB {
  return (_db ??= buildDb());
}