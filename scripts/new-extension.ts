#!/usr/bin/env bun
import { cp, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = join(repoRoot, "templates", "extension");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function toPascal(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

async function replaceInFile(
  path: string,
  replacements: Array<[string | RegExp, string]>,
): Promise<void> {
  const original = await readFile(path, "utf8");
  let next = original;
  for (const [from, to] of replacements) {
    next = next.replaceAll(from as string, to);
  }
  if (next !== original) {
    await writeFile(path, next);
  }
}

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: bun run scripts/new-extension.ts <name>");
    process.exit(1);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`error: name must be kebab-case ([a-z][a-z0-9-]*), got: ${name}`);
    process.exit(1);
  }

  const targetDir = join(repoRoot, "extensions", name);
  if (await exists(targetDir)) {
    console.error(`error: extensions/${name} already exists`);
    process.exit(1);
  }

  await cp(templateDir, targetDir, { recursive: true });

  const pascal = toPascal(name);
  const replacements: Array<[string, string]> = [
    ["@fucc/example-extension", `@fucc/${name}`],
    ["example-extension", name],
    ["exampleExtension", pascal[0]!.toLowerCase() + pascal.slice(1)],
  ];

  await replaceInFile(join(targetDir, "package.json"), [
    ["@fucc/example-extension", `@fucc/${name}`],
  ]);
  await replaceInFile(join(targetDir, "src", "extension", "index.ts"), replacements);
  await replaceInFile(join(targetDir, "SPEC.md"), [["example-extension", name]]);

  console.log(`created extensions/${name}`);
  console.log("next:");
  console.log("  bun install");
  console.log("  ./install.sh");
  console.log("  /reload  (in Pi)");
}

await main();
