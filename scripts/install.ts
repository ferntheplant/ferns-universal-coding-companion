#!/usr/bin/env bun
import { Glob, spawn } from "bun";
import { lstat, mkdir, readFile, realpath, rm, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Manifest {
  settings?: string;
  themes?: string | string[];
  extensions?: string[];
  skills?: string[];
  packages?: string[];
}

interface InstallOptions {
  force: boolean;
  skipPackages: boolean;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "manifest.json");
const homeDir = process.env.HOME;
if (!homeDir) {
  throw new Error("HOME is not set");
}
const piAgentDir = join(homeDir, ".pi", "agent");

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function printHelp(): void {
  console.log(`Usage: bun scripts/install.ts [options]

Symlinks manifest entries into ~/.pi/agent/ and optionally runs pi install for third-party packages.

Options:
  --force           Replace existing paths even when they are not symlinks to this repo (destructive).
  --skip-packages   Do not run pi install; only create symlinks (pi does not need to be on PATH).
  --help            Show this message.

By default, existing files or directories at a symlink target are left untouched (use --force).
Manifest packages are skipped when their name already appears in the output of pi list.
`);
}

function parseArgs(argv: string[]): InstallOptions {
  let force = false;
  let skipPackages = false;
  for (const arg of argv) {
    if (arg === "--force") {
      force = true;
    } else if (arg === "--skip-packages") {
      skipPackages = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      fail(`unknown option: ${arg} (try --help)`);
    } else {
      fail(`unexpected argument: ${arg} (try --help)`);
    }
  }
  return { force, skipPackages };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

function resolveAbs(rel: string): string {
  return isAbsolute(rel) ? rel : join(repoRoot, rel);
}

async function sameSymlinkTarget(src: string, dst: string): Promise<boolean> {
  if (!(await isSymlink(dst))) {
    return false;
  }
  try {
    const [resolvedSrc, resolvedDst] = await Promise.all([realpath(src), realpath(dst)]);
    return resolvedSrc === resolvedDst;
  } catch {
    return false;
  }
}

async function forceLink(src: string, dst: string, opts: InstallOptions): Promise<void> {
  const { force } = opts;
  if (!(await exists(dst))) {
    await mkdir(dirname(dst), { recursive: true });
    await symlink(src, dst);
    console.log(`linked: ${dst} -> ${src}`);
    return;
  }

  if (await sameSymlinkTarget(src, dst)) {
    console.log(`unchanged: ${dst} -> ${src}`);
    return;
  }

  if (await isSymlink(dst)) {
    if (!force) {
      fail(
        `refusing to replace symlink (different target): ${dst}\n` +
          `  expected -> ${src}\n` +
          `  re-run with --force to replace it`,
      );
    }
    await unlink(dst);
  } else if (await exists(dst)) {
    if (!force) {
      fail(
        `refusing to replace existing path (not a symlink to this repo): ${dst}\n` +
          `  re-run with --force to delete it and link -> ${src}`,
      );
    }
    await rm(dst, { recursive: true, force: true });
  }

  await mkdir(dirname(dst), { recursive: true });
  await symlink(src, dst);
  console.log(`linked: ${dst} -> ${src}`);
}

async function ensureRealDir(path: string, opts: InstallOptions): Promise<void> {
  const { force } = opts;
  if (!(await exists(path))) {
    await mkdir(path, { recursive: true });
    return;
  }
  if (await isSymlink(path)) {
    if (!force) {
      fail(
        `refusing to replace symlink with a directory: ${path}\n` +
          `  (this installer expects a real directory here)\n` +
          `  re-run with --force to remove the symlink`,
      );
    }
    await unlink(path);
    await mkdir(path, { recursive: true });
    return;
  }
  if (await isDirectory(path)) {
    return;
  }
  if (!force) {
    fail(`refusing to replace non-directory with a directory: ${path}\n` + `  re-run with --force to remove it`);
  }
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

function isGlob(s: string): boolean {
  return /[*?[]/.test(s);
}

async function expandEntry(entry: string): Promise<string[]> {
  if (!isGlob(entry)) {
    const abs = resolveAbs(entry);
    if (!(await exists(abs))) {
      fail(`entry does not exist: ${entry}`);
    }
    return [abs];
  }
  const glob = new Glob(entry);
  const matches: string[] = [];
  for await (const file of glob.scan({ cwd: repoRoot, onlyFiles: false })) {
    matches.push(join(repoRoot, file));
  }
  if (matches.length === 0) {
    fail(`glob matched nothing: ${entry}`);
  }
  return matches;
}

async function linkArrayEntries(
  _key: string,
  entries: string[] | undefined,
  targetDir: string,
  opts: InstallOptions,
): Promise<void> {
  if (!entries || entries.length === 0) {
    return;
  }
  await ensureRealDir(targetDir, opts);
  for (const entry of entries) {
    const matches = await expandEntry(entry);
    for (const matched of matches) {
      await forceLink(matched, join(targetDir, basename(matched)), opts);
    }
  }
}

function needlesForManifestPackage(pkg: string): string[] {
  const p = pkg.trim();
  const out = new Set<string>();
  if (p.length > 0) {
    out.add(p);
  }
  if (p.startsWith("npm:")) {
    const name = p.slice(4).trim();
    if (name.length >= 2) {
      out.add(name);
    }
  }
  if (p.startsWith("git:")) {
    const spec = p.slice(4).trim();
    if (spec.length >= 2) {
      out.add(spec);
    }
  }
  return [...out];
}

function packageListedInPiList(listOutput: string, pkg: string): boolean {
  if (listOutput.length === 0) {
    return false;
  }
  return needlesForManifestPackage(pkg).some((needle) => listOutput.includes(needle));
}

async function capturePiList(): Promise<string | null> {
  const proc = spawn(["pi", "list"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  if (code !== 0) {
    console.warn(`warning: pi list exited with code ${code}; will run pi install for all manifest packages`);
    if (stderr.trim()) {
      console.warn(stderr.trim());
    }
    return null;
  }
  return `${stdout}\n${stderr}`;
}

async function piInstall(pkg: string): Promise<void> {
  console.log(`installing package: ${pkg}`);
  const proc = spawn(["pi", "install", pkg], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    fail(`pi install ${pkg} exited with code ${code}`);
  }
}

async function requireCmd(cmd: string): Promise<void> {
  const proc = spawn(["which", cmd], { stdout: "ignore", stderr: "ignore" });
  const code = await proc.exited;
  if (code !== 0) {
    fail(`required command not found on PATH: ${cmd}`);
  }
}

async function main(opts: InstallOptions): Promise<void> {
  if (!(await exists(manifestPath))) {
    fail(`manifest not found: ${manifestPath}`);
  }

  if (!opts.skipPackages) {
    await requireCmd("pi");
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  await mkdir(piAgentDir, { recursive: true });

  if (manifest.settings) {
    const settingsSrc = resolveAbs(manifest.settings);
    if (!(await exists(settingsSrc))) {
      fail(`settings path does not exist: ${manifest.settings}`);
    }
    await forceLink(settingsSrc, join(piAgentDir, "settings.json"), opts);
  }

  await linkArrayEntries("extensions", manifest.extensions, join(piAgentDir, "extensions"), opts);
  await linkArrayEntries("skills", manifest.skills, join(piAgentDir, "skills"), opts);

  if (typeof manifest.themes === "string") {
    const themesSrc = resolveAbs(manifest.themes);
    if (!(await exists(themesSrc))) {
      fail(`themes path does not exist: ${manifest.themes}`);
    }
    await forceLink(themesSrc, join(piAgentDir, "themes"), opts);
  } else if (Array.isArray(manifest.themes)) {
    await linkArrayEntries("themes", manifest.themes, join(piAgentDir, "themes"), opts);
  }

  if (opts.skipPackages) {
    console.log("skipped manifest packages (--skip-packages)");
  } else if (manifest.packages && manifest.packages.length > 0) {
    const listOutput = await capturePiList();
    for (const pkg of manifest.packages) {
      if (listOutput && packageListedInPiList(listOutput, pkg)) {
        console.log(`skip pi install (already listed): ${pkg}`);
        continue;
      }
      await piInstall(pkg);
    }
  }

  console.log("install complete");
}

const opts = parseArgs(process.argv.slice(2));
await main(opts);
