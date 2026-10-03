/**
 * Module-local declaration of the one `process` member read here, so the
 * package does not depend on Node typings. At runtime the identifier resolves
 * to the global `process` (or is replaced by the consumer's bundler).
 */
declare const process: { env: { NODE_ENV?: string } };

/**
 * Whether development-only diagnostics should run. The single gate for every
 * development-only `console.warn` in this package (the dotted table-name hint
 * and the ignored-filter warning); do not add a second helper with another
 * policy.
 *
 * Reads `process.env.NODE_ENV` literally so bundlers (Vite, webpack, esbuild,
 * Next.js) statically replace it and a production build sees a constant
 * `false`. Opt-in on purpose — a diagnostic must never fire where development
 * was not asked for, and an unset `NODE_ENV` cannot be told apart from an
 * unconfigured production deployment:
 *
 * - `NODE_ENV === 'production'` → false;
 * - `NODE_ENV` unset (a plain Node script, or a browser `process` shim with an
 *   empty `env`) → false;
 * - no `process` at all, or a `process` without `env` (unbundled browser ESM)
 *   → false;
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
