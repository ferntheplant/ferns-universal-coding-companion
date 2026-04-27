import { atom } from "jotai";
import { fileIdsAtom, filePathAtomFamily } from "./files";
import type { DiffViewMode } from "../lib/diff-cache";

export const sidebarOpenAtom = atom(true);
export const fileFilterAtom = atom("");
export const diffViewModeAtom = atom<DiffViewMode>("split");
export const showUnchangedContextAtom = atom(false);
export const wordWrapAtom = atom(true);

const activeFileOverrideAtom = atom<string | null>(null);

export const activeFileIdAtom = atom(
  (get) => {
    const fileIds = get(fileIdsAtom);
    const override = get(activeFileOverrideAtom);

    if (override && fileIds.includes(override)) {
      return override;
    }

    return fileIds[0] ?? null;
  },
  (get, set, next: string | null) => {
    const fileIds = get(fileIdsAtom);
    if (next === null || fileIds.includes(next)) {
      set(activeFileOverrideAtom, next);
    }
  },
);

export const visibleFileIdsAtom = atom((get) => {
  const filter = get(fileFilterAtom).trim().toLowerCase();
  const fileIds = get(fileIdsAtom);

  if (!filter) {
    return fileIds;
  }

  return fileIds.filter((fileId) => get(filePathAtomFamily(fileId)).toLowerCase().includes(filter));
});
