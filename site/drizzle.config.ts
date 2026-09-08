import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Turso (libSQL). Supports a remote Turso database (libsql://) or a local
// libsql server (http://127.0.0.1:8080). Env vars: TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN (see .env.example).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? '',
    authToken: process.env.TURSO_AUTH_TOKEN
  }
});