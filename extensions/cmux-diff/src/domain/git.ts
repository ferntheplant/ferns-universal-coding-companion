import { formatDiffTarget, type DiffTarget } from "./diff-target";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { makeFileFingerprint, makeFileId } from "./file-id";
import type { RepoMetadata, ReviewFile, ReviewPayload } from "./types";

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface NumstatEntry {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

interface DiffBlobPair {
  oldBlobId?: string;
  newBlobId?: string;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
      });
    });
  });
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand("git", args, cwd);
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
    throw new Error(message);
  }
  return result.stdout;
}

function getDiffRange(target: DiffTarget): string | undefined {
  if (target.kind === "uncommitted") return undefined;
  if (target.kind === "branch") return `${target.value}...HEAD`;
  return `${target.value}..HEAD`;
}

function getDiffBaseArgs(target: DiffTarget): string[] {
  const range = getDiffRange(target);
  return range ? [range] : ["HEAD"];
}

function isUnsupportedPath(path: string): boolean {
  const lowered = path.toLowerCase();
  if (
    lowered.endsWith(".png") ||
    lowered.endsWith(".jpg") ||
    lowered.endsWith(".jpeg") ||
    lowered.endsWith(".gif") ||
    lowered.endsWith(".webp") ||
    lowered.endsWith(".pdf")
  ) {
    return true;
  }

  if (
    lowered.endsWith(".lock") ||
    lowered.endsWith("pnpm-lock.yaml") ||
    lowered.endsWith("bun.lock")
  ) {
    return true;
  }

  return false;
}

function parseNumstat(stdout: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const line of splitLines(stdout)) {
    const [additionsRaw, deletionsRaw, ...rest] = line.split("\t");
    if (!additionsRaw || !deletionsRaw || rest.length === 0) {
      continue;
    }

    const path = rest.join("\t");
    const binary = additionsRaw === "-" || deletionsRaw === "-";
    entries.push({
      path,
      additions: binary ? 0 : Number.parseInt(additionsRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(deletionsRaw, 10) || 0,
      binary,
    });
  }

  return entries;
}

function parseDiffBlobPair(patch: string): DiffBlobPair {
  const indexLine = patch.match(/^index\s+([0-9a-f]+)\.\.([0-9a-f]+)(?:\s+\d+)?$/m);
  if (!indexLine) {
    return {};
  }

  const oldBlobIdRaw = indexLine[1];
  const newBlobIdRaw = indexLine[2];

  const oldBlobId = oldBlobIdRaw && !/^0+$/.test(oldBlobIdRaw) ? oldBlobIdRaw : undefined;
  const newBlobId = newBlobIdRaw && !/^0+$/.test(newBlobIdRaw) ? newBlobIdRaw : undefined;

  return {
    oldBlobId,
    newBlobId,
  };
}

async function loadBlobContent(
  repoRoot: string,
  blobId: string | undefined,
): Promise<string | undefined> {
  if (!blobId) {
    return undefined;
  }

  try {
    return await runGit(repoRoot, ["cat-file", "-p", blobId]);
  } catch {
    return undefined;
  }
}

async function loadWorkingTreeContent(repoRoot: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(`${repoRoot}/${path}`, "utf8");
  } catch {
    return undefined;
  }
}

async function validateTargetExists(repoRoot: string, target: DiffTarget): Promise<void> {
  if (target.kind === "uncommitted") {
    return;
  }

  const verifySpec = `${target.value}^{commit}`;
  const result = await runCommand(
    "git",
    ["rev-parse", "--verify", "--quiet", verifySpec],
    repoRoot,
  );
  if (result.code !== 0) {
    throw new Error(`Unable to resolve ${target.kind} target: ${target.value}`);
  }
}

async function getHeadRef(repoRoot: string): Promise<string | undefined> {
  try {
    const branch = (await runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    if (branch.length > 0) {
      return branch;
    }
  } catch {
    // ignore and try fallback
  }

  try {
    const commit = (await runGit(repoRoot, ["rev-parse", "--short", "HEAD"])).trim();
    return commit.length > 0 ? commit : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveRepoRoot(cwd: string): Promise<string | null> {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], cwd);
  if (result.code !== 0) {
    return null;
  }

  const root = result.stdout.trim();
  return root.length > 0 ? root : null;
}

export async function resolveRepoMetadata(repoRoot: string): Promise<RepoMetadata> {
  return {
    root: repoRoot,
    headRef: await getHeadRef(repoRoot),
  };
}

export async function computeReviewFiles(
  repoRoot: string,
  target: DiffTarget,
): Promise<ReviewFile[]> {
  await validateTargetExists(repoRoot, target);

  const diffBaseArgs = getDiffBaseArgs(target);
  const numstatOutput = await runGit(repoRoot, [
    "diff",
    "--numstat",
    "--diff-filter=ACMR",
    "--find-renames",
    ...diffBaseArgs,
  ]);

  const entries = parseNumstat(numstatOutput)
    .filter((entry) => !entry.binary)
    .filter((entry) => !isUnsupportedPath(entry.path));

  const files: ReviewFile[] = [];
  for (const entry of entries) {
    const patch = await runGit(repoRoot, [
      "diff",
      "--patch",
      "--no-color",
      "--find-renames",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      ...diffBaseArgs,
      "--",
      entry.path,
    ]);

    const { oldBlobId, newBlobId } = parseDiffBlobPair(patch);
    const [oldContentFromBlob, newContentFromBlob] = await Promise.all([
      loadBlobContent(repoRoot, oldBlobId),
      loadBlobContent(repoRoot, newBlobId),
    ]);

    const oldContent = oldContentFromBlob;
    const newContent =
      newContentFromBlob ??
      (target.kind === "uncommitted"
        ? await loadWorkingTreeContent(repoRoot, entry.path)
        : undefined);
    files.push({
      id: makeFileId(entry.path),
      path: entry.path,
      fingerprint: makeFileFingerprint(entry.path, patch),
      patch,
      oldContent,
      newContent,
      additions: entry.additions,
      deletions: entry.deletions,
    });
  }

  return files;
}

export async function buildReviewPayload(
  repoRoot: string,
  target: DiffTarget,
): Promise<ReviewPayload> {
  const [repo, files] = await Promise.all([
    resolveRepoMetadata(repoRoot),
    computeReviewFiles(repoRoot, target),
  ]);

  return {
    repo,
    target,
    targetLabel: formatDiffTarget(target),
    generatedAt: Date.now(),
    files,
  };
}
