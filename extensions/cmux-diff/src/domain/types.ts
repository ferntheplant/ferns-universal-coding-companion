import type { DiffTarget } from "./diff-target";

export interface RepoMetadata {
  root: string;
  headRef?: string;
}

export interface ReviewFile {
  id: string;
  path: string;
  fingerprint: string;
  patch: string;
  oldContent?: string;
  newContent?: string;
  additions: number;
  deletions: number;
}

export interface ReviewPayload {
  repo: RepoMetadata;
  target: DiffTarget;
  targetLabel: string;
  generatedAt: number;
  files: ReviewFile[];
}

export type CommentScope = "overall" | "file" | "line";

export interface CommentDraft {
  id: string;
  scope: CommentScope;
  fileId?: string;
  filePath?: string;
  line?: number;
  text: string;
  createdAt: number;
}

export interface CommentSubmitPayload {
  comments: CommentDraft[];
  submittedAt: number;
}
