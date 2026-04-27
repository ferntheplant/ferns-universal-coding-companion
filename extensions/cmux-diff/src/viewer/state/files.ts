import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { ReviewFile } from "../../domain/types";
import { reviewPayloadAtom } from "./atoms";
import { commentsByFileAtom, lineCommentsByKeyAtom } from "./comments";

export interface SidebarTreeNode {
  commentCount?: number;
  id: string;
  kind: "folder" | "file";
  name: string;
  path: string;
  fileId?: string;
  additions?: number;
  deletions?: number;
  children?: SidebarTreeNode[];
}

export const fileIdsAtom = atom(
  (get) => get(reviewPayloadAtom)?.files.map((file) => file.id) ?? [],
);

export const filesByIdAtom = atom<Record<string, ReviewFile>>((get) => {
  const files = get(reviewPayloadAtom)?.files ?? [];
  return files.reduce<Record<string, ReviewFile>>((acc, file) => {
    acc[file.id] = file;
    return acc;
  }, {});
});

export const fileByIdAtomFamily = atomFamily((fileId: string) =>
  atom((get) => get(filesByIdAtom)[fileId] ?? null),
);

export const filePathAtomFamily = atomFamily((fileId: string) =>
  atom((get) => get(fileByIdAtomFamily(fileId))?.path ?? ""),
);

function sortTree(nodes: SidebarTreeNode[]): SidebarTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  return sorted.map((node) => {
    if (!node.children) {
      return node;
    }

    return {
      ...node,
      children: sortTree(node.children),
    };
  });
}

export const sidebarTreeDataAtom = atom<SidebarTreeNode[]>((get) => {
  const files = get(reviewPayloadAtom)?.files ?? [];
  const fileComments = get(commentsByFileAtom);
  const lineComments = get(lineCommentsByKeyAtom);
  const rootNodes: SidebarTreeNode[] = [];
  const folderByPath = new Map<string, SidebarTreeNode>();
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    const fileName = segments.at(-1) ?? file.path;

    let currentPath = "";
    let children = rootNodes;

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      let folder = folderByPath.get(currentPath);
      if (!folder) {
        folder = {
          id: `dir:${currentPath}`,
          kind: "folder",
          name: segment,
          path: currentPath,
          children: [],
        };

        folderByPath.set(currentPath, folder);
        children.push(folder);
      }

      children = folder.children ?? [];
    }

    // Calculate comment count for this file
    let commentCount = 0;
    const fileDraft = fileComments[file.id];
    if ((fileDraft?.summary?.trim().length ?? 0) > 0) {
      commentCount++;
    }
    // Count line comments for this file
    const prefix = `${file.id}:`;
    for (const [key, text] of Object.entries(lineComments)) {
      if (key.startsWith(prefix) && (text?.trim().length ?? 0) > 0) {
        commentCount++;
      }
    }

    children.push({
      id: file.id,
      kind: "file",
      name: fileName,
      path: file.path,
      fileId: file.id,
      additions: file.additions,
      deletions: file.deletions,
      commentCount,
    });
  }

  return sortTree(rootNodes);
});
