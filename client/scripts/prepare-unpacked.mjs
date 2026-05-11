import { existsSync } from 'node:fs';
import { rm, rename } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.resolve('release');
const builderOutputDir = path.join(releaseDir, 'win-unpacked');
const finalOutputDir = path.join(releaseDir, 'CiRCLE');

function assertInsideRelease(targetPath) {
  const relativePath = path.relative(releaseDir, targetPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to modify path outside release directory: ${targetPath}`);
  }
}

assertInsideRelease(builderOutputDir);
assertInsideRelease(finalOutputDir);

if (!existsSync(builderOutputDir)) {
  throw new Error(`Expected Electron output directory not found: ${builderOutputDir}`);
}

if (existsSync(finalOutputDir)) {
  await rm(finalOutputDir, { recursive: true, force: true });
}

await rename(builderOutputDir, finalOutputDir);
console.log(`Prepared unpacked app: ${path.relative(process.cwd(), finalOutputDir)}`);
