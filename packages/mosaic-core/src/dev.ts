/**
 * Module-local declaration of the one `process` member read here, so the
 * package does not depend on Node typings. At runtime the identifier resolves
 * to the global `process` (or is replaced by the consumer's bundler).
 */
declare const process: { env: { NODE_ENV?: string } };

/**
 * Whether development-only diagnostics should run.
 *
 * Reads `process.env.NODE_ENV` literally so bundlers (Vite, webpack, esbuild,
 * Next.js) statically replace it and strip the diagnostics from production
 * builds. Conservative on purpose — a diagnostic must never fire where it was
 * not asked for:
 *
 * - `NODE_ENV === 'production'` → false;
 * - `NODE_ENV` unset (a plain Node script, or a browser `process` shim with an
 *   empty `env`) → false;
 * - no `process` at all (unbundled browser ESM) → false;
 * - anything else (`'development'`, `'test'`) → true.
 */
export function isDevelopment(): boolean {
  try {
    const env = process.env.NODE_ENV;
    return env !== undefined && env !== 'production';
  } catch {
    return false;
  }
}
