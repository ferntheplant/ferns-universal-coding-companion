export type DiffTarget =
  | { kind: "uncommitted" }
  | { kind: "branch"; value: string }
  | { kind: "commit"; value: string };

export function formatDiffTarget(target: DiffTarget): string {
  if (target.kind === "uncommitted") return "uncommitted";
  return `${target.kind}:${target.value}`;
}

export function validateDiffTarget(
  target: DiffTarget,
): { valid: true } | { valid: false; error: string } {
  if (target.kind === "uncommitted") {
    return { valid: true };
  }

  const trimmed = target.value.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: `Diff target ${target.kind} value cannot be empty.`,
    };
  }

  if (/\s/.test(trimmed)) {
    return {
      valid: false,
      error: `Diff target ${target.kind} value cannot contain whitespace.`,
    };
  }

  return { valid: true };
}

export function parseDiffTargetSpec(spec: string): DiffTarget {
  const value = spec.trim();
  if (!value || value === "uncommitted") {
    return { kind: "uncommitted" };
  }

  const branchPrefix = "branch:";
  if (value.startsWith(branchPrefix)) {
    return { kind: "branch", value: value.slice(branchPrefix.length).trim() };
  }

  const commitPrefix = "commit:";
  if (value.startsWith(commitPrefix)) {
    return { kind: "commit", value: value.slice(commitPrefix.length).trim() };
  }

  if (/^[0-9a-f]{7,40}$/i.test(value)) {
    return { kind: "commit", value };
  }

  return { kind: "branch", value };
}
