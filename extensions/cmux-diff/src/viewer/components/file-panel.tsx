import { useMemo, useState, useCallback } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Comments } from "./comments";
import { GitDiffFileView } from "./git-diff-file-view";
import { fileByIdAtomFamily } from "../state/files";
import {
  activeFileIdAtom,
  diffViewModeAtom,
  showUnchangedContextAtom,
  wordWrapAtom,
} from "../state/ui";
import { lineCommentsByKeyAtom } from "../state/comments";

export function FilePanel() {
  const activeFileId = useAtomValue(activeFileIdAtom);

  if (!activeFileId) {
    return <section className="file-panel">No files in this review.</section>;
  }

  return <ActiveFilePanel fileId={activeFileId} />;
}

function ActiveFilePanel({ fileId }: { fileId: string }) {
  const file = useAtomValue(fileByIdAtomFamily(fileId));
  const viewMode = useAtomValue(diffViewModeAtom);
  const showUnchanged = useAtomValue(showUnchangedContextAtom);
  const wordWrap = useAtomValue(wordWrapAtom);
  const [lineComments, setLineComments] = useAtom(lineCommentsByKeyAtom);

  // Track which line has an active comment being edited
  const [activeCommentLine, setActiveCommentLine] = useState<{
    lineNumber: number;
    side: "deletions" | "additions";
  } | null>(null);

  const displayOptions = useMemo(
    () => ({
      viewMode,
      showUnchanged,
      wordWrap,
    }),
    [showUnchanged, viewMode, wordWrap],
  );

  // Build a Map of line comments for the current file
  const fileLineComments = useMemo(() => {
    const map = new Map<string, string>();
    const prefix = `${fileId}:`;
    for (const [key, text] of Object.entries(lineComments)) {
      if (key.startsWith(prefix) && text.trim()) {
        // Convert from "fileId:lineNumber" to "lineNumber:side" format
        const lineStr = key.slice(prefix.length);
        const lineNumber = parseInt(lineStr, 10);
        if (!isNaN(lineNumber)) {
          // For now, we associate comments with the "additions" side by default
          // In the future, we could track which side the comment was made on
          map.set(`${lineNumber}:additions`, text);
        }
      }
    }
    return map;
  }, [lineComments, fileId]);

  const handleAddLineComment = useCallback(
    (lineNumber: number, side: "deletions" | "additions") => {
      setActiveCommentLine({ lineNumber, side });
    },
    [],
  );

  const handleEditLineComment = useCallback(
    (lineNumber: number, side: "deletions" | "additions") => {
      setActiveCommentLine({ lineNumber, side });
    },
    [],
  );

  const handleCloseLineComment = useCallback(() => {
    setActiveCommentLine(null);
  }, []);

  const handleUpdateLineComment = useCallback(
    (lineNumber: number, side: "deletions" | "additions", text: string) => {
      // Update the line comment atom directly via the key-value atom
      // Update the atom directly
      setLineComments((prev) => ({
        ...prev,
        [`${fileId}:${lineNumber}`]: text,
      }));
    },
    [fileId, setLineComments],
  );

  if (!file) {
    return <section className="file-panel">File not found.</section>;
  }

  return (
    <section className="file-panel">
      <div className="file-panel__header">
        <h2>{file.path}</h2>
        <div className="file-panel__stats">
          <span>+{file.additions}</span>
          <span>-{file.deletions}</span>
        </div>
      </div>

      <GitDiffFileView
        file={file}
        fileId={fileId}
        displayOptions={displayOptions}
        onAddLineComment={handleAddLineComment}
        onEditLineComment={handleEditLineComment}
        activeCommentLine={activeCommentLine}
        onCloseActiveComment={handleCloseLineComment}
        onUpdateLineComment={handleUpdateLineComment}
        lineComments={fileLineComments}
      />

      <Comments fileId={fileId} />
    </section>
  );
}
