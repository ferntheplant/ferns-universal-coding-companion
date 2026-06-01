import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import type { GitContext } from "./types.js";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", args, { cwd, timeout: 3000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function getGitContext(cwd: string): Promise<GitContext> {
  const [remote, branch, commit] = await Promise.all([
    git(["remote", "get-url", "origin"], cwd),
    git(["branch", "--show-current"], cwd),
    git(["rev-parse", "--short", "HEAD"], cwd),
  ]);

  const repo = remote
    ? (remote.match(/\/([^/]+?)(?:\.git)?$/)?.[1] ?? basename(cwd))
    : basename(cwd);

  return { repo, repoRemote: remote, gitBranch: branch, gitCommit: commit };
}
