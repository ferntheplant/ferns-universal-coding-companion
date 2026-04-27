#!/usr/bin/env bun
import { Glob, spawn } from "bun";
import { lstat, mkdir, readFile, rm, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Manifest {
  settings?: string;
  themes?: string | string[];
  extensions?: string[];
  skills?: string[];
  packages?: string[];
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

function resolveAbs(rel: string): string {
  return isAbsolute(rel) ? rel : join(repoRoot, rel);
}

async function forceLink(src: string, dst: string): Promise<void> {
  if (await isSymlink(dst)) {
    await unlink(dst);
  } else if (await exists(dst)) {
    await rm(dst, { recursive: true, force: true });
  }
  await mkdir(dirname(dst), { recursive: true });
  await symlink(src, dst);
  console.log(`linked: ${dst} -> ${src}`);
}

async function ensureRealDir(path: string): Promise<void> {
  if (await isSymlink(path)) {
    await unlink(path);
  }
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
  key: string,
  entries: string[] | undefined,
  targetDir: string,
): Promise<void> {
  if (!entries || entries.length === 0) {
    return;
  }
  await ensureRealDir(targetDir);
  for (const entry of entries) {
    const matches = await expandEntry(entry);
    for (const matched of matches) {
      await forceLink(matched, join(targetDir, basename(matched)));
    }
  }
  void key;
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

async function main(): Promise<void> {
  if (!(await exists(manifestPath))) {
    fail(`manifest not found: ${manifestPath}`);
  }
  await requireCmd("pi");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  await mkdir(piAgentDir, { recursive: true });

  if (manifest.settings) {
    const settingsSrc = resolveAbs(manifest.settings);
    if (!(await exists(settingsSrc))) {
      fail(`settings path does not exist: ${manifest.settings}`);
    }
    await forceLink(settingsSrc, join(piAgentDir, "settings.json"));
  }

  await linkArrayEntries("extensions", manifest.extensions, join(piAgentDir, "extensions"));
  await linkArrayEntries("skills", manifest.skills, join(piAgentDir, "skills"));

  if (typeof manifest.themes === "string") {
    const themesSrc = resolveAbs(manifest.themes);
    if (!(await exists(themesSrc))) {
      fail(`themes path does not exist: ${manifest.themes}`);
    }
    await forceLink(themesSrc, join(piAgentDir, "themes"));
  } else if (Array.isArray(manifest.themes)) {
    await linkArrayEntries("themes", manifest.themes, join(piAgentDir, "themes"));
  }

  if (manifest.packages) {
    for (const pkg of manifest.packages) {
      await piInstall(pkg);
    }
  }

  console.log("install complete");
}

await main();
