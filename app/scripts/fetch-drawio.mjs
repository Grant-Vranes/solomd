#!/usr/bin/env node
/**
 * fetch-drawio.mjs — downloads the pinned diagrams.net webapp (draw.war) and
 * unpacks it into src-tauri/resources/drawio/ for OFFLINE iframe embedding.
 * The directory is gitignored; run this once per machine (or via
 * `pnpm fetch:drawio`) before a desktop release build.
 *
 * Ported from horseMD's scripts/fetch-drawio.mjs. The version is pinned
 * deliberately; upgrading drawio is an explicit human action (change
 * PINNED_VERSION, re-run).
 *
 * Uses the system `unzip` CLI (present on macOS/Linux; on Windows use WSL,
 * Git Bash, or `tar -xf` fallback — tar on Win10+ handles zip).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_VERSION = '31.4.5';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src-tauri', 'resources', 'drawio');
const versionFile = join(target, 'DRAWIO_VERSION');

if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === PINNED_VERSION) {
  console.log(`drawio v${PINNED_VERSION} already vendored at ${target}`);
  process.exit(0);
}

const url = `https://github.com/jgraph/drawio/releases/download/v${PINNED_VERSION}/draw.war`;
mkdirSync(target, { recursive: true });
const warPath = join(tmpdir(), `draw-${PINNED_VERSION}.war`);

console.log(`Downloading ${url} ...`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
if (buf.length < 1024 * 1024) {
  console.error(`Downloaded file is suspiciously small (${buf.length} bytes) — aborting`);
  process.exit(1);
}
writeFileSync(warPath, buf);

console.log(`Unpacking into ${target} ...`);
const staging = mkdtempSync(join(tmpdir(), 'drawio-'));
try {
  try {
    execFileSync('unzip', ['-q', '-o', warPath, '-d', staging], { stdio: 'inherit' });
  } catch {
    // Windows: bsdtar (bundled with Windows 10+) reads zip archives too.
    execFileSync('tar', ['-xf', warPath, '-C', staging], { stdio: 'inherit' });
  }
  // The war may unpack with a single top-level folder or straight at the root.
  const entries = readdirSync(staging);
  const srcDir =
    entries.length === 1 && existsSync(join(staging, entries[0], 'WEB-INF'))
      ? join(staging, entries[0])
      : staging;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  execFileSync('cp', ['-R', `${srcDir}/.`, target], { stdio: 'inherit' });
} finally {
  rmSync(staging, { recursive: true, force: true });
  rmSync(warPath, { force: true });
}

// Sanity checks: the files the iframe actually loads must exist.
for (const required of ['index.html', join('js', 'app.min.js')]) {
  if (!existsSync(join(target, required))) {
    console.error(`Vendored webapp is missing ${required} — the war layout may have changed`);
    process.exit(1);
  }
}
writeFileSync(versionFile, PINNED_VERSION + '\n');
// Keep the committed README (the only tracked file in this directory — it
// also guarantees the `resources/drawio/**` bundle glob always matches).
writeFileSync(
  join(target, 'README.md'),
  `# Offline diagrams.net bundle\n\nVendored drawio v${PINNED_VERSION} by scripts/fetch-drawio.mjs.\n`,
);
console.log(`drawio v${PINNED_VERSION} vendored OK (offline mode enabled)`);
