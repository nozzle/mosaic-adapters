import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = process.cwd();
const packagesDir = path.join(workspaceRoot, 'packages');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPublishablePackage(manifest) {
  if (!isObject(manifest)) {
    return false;
  }

  if (manifest.private === true) {
    return false;
  }

  return typeof manifest.name === 'string' && manifest.name.length > 0;
}

function isWorkspaceProtocol(range) {
  return range.startsWith('workspace:');
}

function isExactVersion(range) {
  return /^=?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range);
}

function isAllowedPeerRange(range) {
  return !isWorkspaceProtocol(range) && !isExactVersion(range);
}

async function readManifest(manifestPath) {
  const source = await readFile(manifestPath, 'utf8');

  return JSON.parse(source);
}

async function getPackageManifestPaths() {
  const entries = await readdir(packagesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name, 'package.json'));
}

async function main() {
  const manifestPaths = await getPackageManifestPaths();
  const manifests = await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      manifestPath,
      manifest: await readManifest(manifestPath),
    })),
  );

  const publishablePackages = manifests.filter(({ manifest }) =>
    isPublishablePackage(manifest),
  );
  const internalPackageNames = new Set(
    publishablePackages.map(({ manifest }) => manifest.name),
  );
  const violations = [];

  for (const { manifest, manifestPath } of publishablePackages) {
    const peerDependencies = isObject(manifest.peerDependencies)
      ? manifest.peerDependencies
      : {};

    for (const [dependencyName, dependencyRange] of Object.entries(
      peerDependencies,
    )) {
      if (!internalPackageNames.has(dependencyName)) {
        continue;
      }

      if (typeof dependencyRange !== 'string') {
        violations.push(
          `${manifest.name}: peer dependency "${dependencyName}" must be a string in ${path.relative(workspaceRoot, manifestPath)}`,
        );
        continue;
      }

      if (isAllowedPeerRange(dependencyRange)) {
        continue;
      }

      violations.push(
        `${manifest.name}: peer dependency "${dependencyName}" uses disallowed range "${dependencyRange}" in ${path.relative(workspaceRoot, manifestPath)}. Use an explicit semver range such as ">=0.1.0 <1" or "^1.2.0".`,
      );
    }
  }

  if (violations.length === 0) {
    console.info('Internal peer dependency ranges look valid.');
    return;
  }

  console.error('Invalid internal peer dependency ranges found:\n');

  for (const violation of violations) {
    console.error(`- ${violation}`);
  }

  process.exitCode = 1;
}

await main();
