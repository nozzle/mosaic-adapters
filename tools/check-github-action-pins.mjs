#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const fullShaPattern = /^[a-f0-9]{40}$/i;
const workflowFilePattern = /\.ya?ml$/i;
const usesPattern = /^(\s*(?:-\s*)?uses:\s*)(['"]?)([^'"\s#]+)(\2)(.*)$/;

const defaultWorkflowGlobs = [
  '.github/workflows',
  '.github/actions',
  'action.yml',
  'action.yaml',
];

/**
 * @typedef {{ owner: string, repo: string, subpath: string, ref: string }} ActionRef
 * @typedef {{ ok: true, sha: string } | { ok: false, message: string }} Resolution
 * @typedef {{
 *   filePath: string,
 *   lineNumber: number,
 *   line: string,
 *   prefix: string,
 *   quote: string,
 *   suffix: string,
 *   specifier: string,
 *   actionRef: ActionRef,
 *   resolution?: Resolution,
 * }} Finding
 * @typedef {{ object?: { type?: string, sha?: string, url?: string } }} GitHubRefResponse
 * @typedef {(owner: string, repo: string, refPath: string) => Promise<GitHubRefResponse | null>} FetchRef
 * @typedef {{ cwd?: string, fetchRef?: FetchRef }} MainOptions
 * @typedef {{ help: boolean, paths: string[], reportOnly: boolean, resolveRefs: boolean }} ParsedArgs
 * @typedef {{ cwd: string, resolveRefs: boolean }} ReportOptions
 * @typedef {{ isDirectory(): boolean, isFile(): boolean, name: string }} Dirent
 * @typedef {{ isDirectory(): boolean, isFile(): boolean }} Stats
 */

/**
 * @param {string[]} [argv]
 * @param {MainOptions} [options]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const parsedArgs = parseArgs(argv);

  if (parsedArgs.help) {
    console.info(getHelpText());
    return 0;
  }

  const scanRoots =
    parsedArgs.paths.length > 0 ? parsedArgs.paths : defaultWorkflowGlobs;
  const workflowFiles = await findWorkflowFiles(cwd, scanRoots);
  const findings = await collectFindings(workflowFiles, {
    cwd,
    resolveRefs: parsedArgs.resolveRefs,
    fetchRef: options.fetchRef ?? fetchGitHubRef,
  });

  printReport(findings, {
    cwd,
    resolveRefs: parsedArgs.resolveRefs,
  });

  if (findings.length === 0) {
    return 0;
  }

  return parsedArgs.reportOnly ? 0 : 1;
}

/**
 * @param {string} content
 * @param {string} filePath
 * @returns {Finding[]}
 */
export function parseWorkflowContent(content, filePath) {
  /** @type {Finding[]} */
  const findings = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const match = usesPattern.exec(line);

    if (!match) {
      continue;
    }

    const specifier = match[3];

    if (!specifier) {
      continue;
    }

    const actionRef = parseActionRef(specifier);

    if (!actionRef) {
      continue;
    }

    if (fullShaPattern.test(actionRef.ref)) {
      continue;
    }

    findings.push({
      filePath,
      lineNumber: index + 1,
      line,
      prefix: match[1] ?? '',
      quote: match[2] ?? '',
      suffix: match[5] ?? '',
      specifier,
      actionRef,
    });
  }

  return findings;
}

/**
 * @param {string} specifier
 * @returns {ActionRef | null}
 */
export function parseActionRef(specifier) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return null;
  }

  if (specifier.startsWith('docker://')) {
    return null;
  }

  if (specifier.includes('${{')) {
    return null;
  }

  const atIndex = specifier.lastIndexOf('@');

  if (atIndex < 1 || atIndex === specifier.length - 1) {
    return null;
  }

  const actionPath = specifier.slice(0, atIndex);
  const ref = specifier.slice(atIndex + 1);
  const pathParts = actionPath.split('/');

  if (pathParts.length < 2) {
    return null;
  }

  const [owner, repo, ...subpathParts] = pathParts;

  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
    subpath: subpathParts.join('/'),
    ref,
  };
}

/**
 * @param {string[]} filePaths
 * @param {{ cwd: string, resolveRefs: boolean, fetchRef: FetchRef }} options
 * @returns {Promise<Finding[]>}
 */
export async function collectFindings(filePaths, options) {
  /** @type {Finding[]} */
  const findings = [];

  for (const filePath of filePaths) {
    const content = await fs.readFile(filePath, 'utf8');
    findings.push(...parseWorkflowContent(content, filePath));
  }

  if (!options.resolveRefs) {
    return findings;
  }

  for (const finding of findings) {
    finding.resolution = await resolveFinding(finding, options.fetchRef);
  }

  return findings;
}

/**
 * @param {string} cwd
 * @param {string[]} scanRoots
 * @returns {Promise<string[]>}
 */
export async function findWorkflowFiles(cwd, scanRoots) {
  /** @type {string[]} */
  const files = [];

  for (const scanRoot of scanRoots) {
    const absoluteRoot = path.resolve(cwd, scanRoot);
    const rootFiles = await listYamlFiles(absoluteRoot);
    files.push(...rootFiles);
  }

  return files.sort();
}

/**
 * @param {ActionRef} actionRef
 * @param {FetchRef} [fetchRef]
 * @returns {Promise<Resolution>}
 */
export async function resolveGitHubRef(actionRef, fetchRef = fetchGitHubRef) {
  const tag = await fetchRef(
    actionRef.owner,
    actionRef.repo,
    `tags/${actionRef.ref}`,
  );

  if (tag) {
    return dereferenceGitObject(tag, fetchRef);
  }

  const branch = await fetchRef(
    actionRef.owner,
    actionRef.repo,
    `heads/${actionRef.ref}`,
  );

  if (branch) {
    return dereferenceGitObject(branch, fetchRef);
  }

  return {
    ok: false,
    message: `Could not find a tag or branch named ${actionRef.ref}.`,
  };
}

/**
 * @param {string[]} argv
 * @returns {ParsedArgs}
 */
function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const args = {
    help: false,
    paths: [],
    reportOnly: false,
    resolveRefs: true,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--report-only') {
      args.reportOnly = true;
      continue;
    }

    if (arg === '--no-resolve') {
      args.resolveRefs = false;
      continue;
    }

    args.paths.push(arg);
  }

  return args;
}

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function listYamlFiles(root) {
  const stats = await getStats(root);

  if (!stats) {
    return [];
  }

  if (stats.isFile()) {
    return workflowFilePattern.test(path.basename(root)) ? [root] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  /** @type {Dirent[]} */
  let entries;

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  /** @type {string[]} */
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listYamlFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && workflowFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

/**
 * @param {string} filePath
 * @returns {Promise<Stats | null>}
 */
async function getStats(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

/**
 * @param {unknown} error
 * @returns {error is { code: string }}
 */
function isNodeError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  );
}

/**
 * @param {Finding} finding
 * @param {FetchRef} fetchRef
 * @returns {Promise<Resolution>}
 */
async function resolveFinding(finding, fetchRef) {
  try {
    return await resolveGitHubRef(finding.actionRef, fetchRef);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @type {FetchRef}
 */
async function fetchGitHubRef(owner, repo, refPath) {
  const encodedRefPath = refPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/${encodedRefPath}`,
    {
      headers: getGitHubHeaders(),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub returned ${response.status} for ${owner}/${repo}@${refPath}.`,
    );
  }

  return response.json();
}

/**
 * @returns {Record<string, string>}
 */
function getGitHubHeaders() {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'mosaic-adapters-action-pin-check',
    'x-github-api-version': '2022-11-28',
  };

  if (!process.env.GITHUB_TOKEN) {
    return headers;
  }

  return {
    ...headers,
    authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };
}

/**
 * @param {GitHubRefResponse} refObject
 * @param {FetchRef} fetchRef
 * @returns {Promise<Resolution>}
 */
async function dereferenceGitObject(refObject, fetchRef) {
  const object = refObject.object;

  if (!object) {
    return {
      ok: false,
      message: 'GitHub response did not include an object.',
    };
  }

  if (object.type === 'commit') {
    if (!object.sha) {
      return {
        ok: false,
        message: 'GitHub commit response did not include a SHA.',
      };
    }

    return {
      ok: true,
      sha: object.sha,
    };
  }

  if (object.type !== 'tag') {
    return {
      ok: false,
      message: `GitHub ref resolved to ${object.type}, not a commit.`,
    };
  }

  if (!object.url) {
    return {
      ok: false,
      message: 'GitHub tag response did not include a URL.',
    };
  }

  const tagObject = await fetchJson(object.url);
  const target = tagObject.object;

  if (target?.type !== 'commit') {
    return {
      ok: false,
      message: `Annotated tag resolved to ${target?.type ?? 'unknown'}, not a commit.`,
    };
  }

  if (!target.sha) {
    return {
      ok: false,
      message: 'Annotated tag commit response did not include a SHA.',
    };
  }

  return {
    ok: true,
    sha: target.sha,
  };
}

/**
 * @param {string} url
 * @returns {Promise<GitHubRefResponse>}
 */
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: getGitHubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${url}.`);
  }

  return response.json();
}

/**
 * @param {Finding[]} findings
 * @param {ReportOptions} options
 * @returns {void}
 */
function printReport(findings, options) {
  if (findings.length === 0) {
    console.info('All external GitHub Actions are pinned to full commit SHAs.');
    return;
  }

  console.error(
    `Found ${findings.length} unpinned GitHub Action reference${findings.length === 1 ? '' : 's'}:`,
  );

  for (const finding of findings) {
    const relativePath = path.relative(options.cwd, finding.filePath);
    console.error(`\n${relativePath}:${finding.lineNumber}`);
    console.error(`  current: ${finding.line.trim()}`);

    if (!options.resolveRefs) {
      continue;
    }

    const resolution = finding.resolution;

    if (!resolution?.ok) {
      console.error(
        `  resolve: ${resolution?.message ?? 'Resolution was not attempted.'}`,
      );
      continue;
    }

    console.error(`  update:  ${formatPinnedLine({ ...finding, resolution })}`);
  }

  console.error(
    '\nUse full commit SHAs for external actions and keep the original tag or branch as the same-line comment.',
  );
}

/**
 * @param {Finding & { resolution: { ok: true, sha: string } }} finding
 * @returns {string}
 */
function formatPinnedLine(finding) {
  const { actionRef, resolution } = finding;
  const subpath = actionRef.subpath ? `/${actionRef.subpath}` : '';
  const pinnedSpecifier = `${actionRef.owner}/${actionRef.repo}${subpath}@${resolution.sha}`;
  return `${finding.prefix}${finding.quote}${pinnedSpecifier}${finding.quote} # ${actionRef.ref}`;
}

/**
 * @returns {string}
 */
function getHelpText() {
  return `Usage: node tools/check-github-action-pins.mjs [--report-only] [--no-resolve] [path...]

Checks GitHub Actions workflow and composite action YAML files for external
uses: references that are not pinned to a full 40-character commit SHA.

By default the tool scans .github/workflows and .github/actions, resolves
unpinned refs through the GitHub API, prints the suggested SHA-pinned line,
and exits 1 when unpinned refs are found.
`;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
