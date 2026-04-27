import { Component, memo, useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import type { ReviewFile } from "../../domain/types";
import {
  buildParsedDiffCacheKey,
  getCachedDiff,
  setCachedDiff,
  type DiffDisplayOptions,
} from "../lib/diff-cache";
import { parseReviewFileDiff, type ParsedReviewFileDiff } from "../lib/diff-parser";

// Annotation data for inline comments
export interface LineCommentAnnotation {
  type: "comment" | "comment-input";
  lineNumber: number;
  side: "deletions" | "additions";
  text?: string;
  fileId: string;
  filePath: string;
  onClose?: () => void;
}

interface GitDiffFileViewProps {
  file: ReviewFile;
  fileId: string;
  displayOptions: DiffDisplayOptions;
  onAddLineComment?: (lineNumber: number, side: "deletions" | "additions") => void;
  activeCommentLine?: { lineNumber: number; side: "deletions" | "additions" } | null;
  onCloseActiveComment?: () => void;
  onUpdateLineComment?: (lineNumber: number, side: "deletions" | "additions", text: string) => void;
  onEditLineComment?: (lineNumber: number, side: "deletions" | "additions") => void;
  // Line comments data: map of "lineNumber:side" -> comment text
  lineComments?: Map<string, string>;
}

interface RenderErrorBoundaryProps {
  children: ReactNode;
}

interface RenderErrorBoundaryState {
  error: string | null;
}

class RenderErrorBoundary extends Component<RenderErrorBoundaryProps, RenderErrorBoundaryState> {
  override state: RenderErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): RenderErrorBoundaryState {
    const message = error instanceof Error ? error.message : "Failed to render diff.";
    return { error: message };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="git-diff-file-view__empty">Unable to render diff: {this.state.error}</div>
      );
    }

    return this.props.children;
  }
}

function parseCachedFileDiff(file: ReviewFile): ParsedReviewFileDiff {
  const fingerprint =
    typeof file.fingerprint === "string" ? file.fingerprint : `unknown:${file.path ?? "file"}`;
  const cacheKey = buildParsedDiffCacheKey(fingerprint);
  const cached = getCachedDiff<ParsedReviewFileDiff>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const parsed = parseReviewFileDiff(file);
    if (!parsed.error) {
      setCachedDiff(cacheKey, parsed);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown diff parse error";
    return {
      fileDiff: null,
      error: message,
    };
  }
}

// Inline comment input component
function InlineCommentInput({
  lineNumber,
  filePath,
  text,
  onChange,
  onClose,
}: {
  lineNumber: number;
  filePath: string;
  text: string;
  onChange: (text: string) => void;
  onClose: () => void;
}) {
  // Use local state for the textarea to prevent cursor jumping
  const [localText, setLocalText] = useState(text);
  const handleCancel = () => {
    if (!localText.trim()) {
      onChange("");
    }
    onClose();
  };

  return (
    <div className="inline-comment-input">
      <div className="inline-comment-input__header">
        <span className="inline-comment-input__meta">
          Line {lineNumber} — {filePath}
        </span>
        <button
          className="inline-comment-input__close"
          onClick={handleCancel}
          type="button"
          aria-label="Cancel comment"
        >
          ×
        </button>
      </div>
      <textarea
        className="inline-comment-input__textarea"
        value={localText}
        onChange={(e) => setLocalText(e.target.value)}
        placeholder="Add a comment on this line..."
        autoFocus
        rows={3}
      />
      <div className="inline-comment-input__actions">
        <button
          className="inline-comment-input__button inline-comment-input__button--secondary"
          onClick={handleCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="inline-comment-input__button inline-comment-input__button--primary"
          onClick={() => {
            onChange(localText);
            onClose();
          }}
          type="button"
          disabled={!localText.trim()}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// Inline saved comment display
function InlineSavedComment({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <div className="inline-saved-comment" onClick={onClick} role="button" tabIndex={0}>
      <div className="inline-saved-comment__text">{text}</div>
    </div>
  );
}

function GitDiffFileViewImpl({
  file,
  fileId,
  displayOptions,
  onAddLineComment,
  activeCommentLine,
  onCloseActiveComment,
  onUpdateLineComment,
  onEditLineComment,
  lineComments,
}: GitDiffFileViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const parsed = useMemo(
    () => parseCachedFileDiff(file),
    [file.fingerprint, file.patch, file.path, file.oldContent, file.newContent],
  );

  const preserveContainerScroll = useCallback((action: () => void) => {
    const container = containerRef.current;
    const scrollTop = container?.scrollTop ?? 0;
    const scrollLeft = container?.scrollLeft ?? 0;
    action();
    requestAnimationFrame(() => {
      const current = containerRef.current;
      if (!current) {
        return;
      }
      current.scrollTop = scrollTop;
      current.scrollLeft = scrollLeft;
    });
  }, []);

  // Build line annotations for inline comments
  const lineAnnotations = useMemo(() => {
    const annotations: Array<{
      lineNumber: number;
      side: "deletions" | "additions";
      metadata: LineCommentAnnotation;
    }> = [];

    // Add annotations for saved line comments
    if (lineComments) {
      for (const [key, text] of lineComments.entries()) {
        const match = key.match(/^(\d+):(deletions|additions)$/);
        if (match && match[1] && match[2]) {
          const lineNumber = parseInt(match[1], 10);
          const side = match[2] as "deletions" | "additions";
          annotations.push({
            lineNumber,
            side,
            metadata: {
              type: "comment",
              lineNumber,
              side,
              text,
              fileId,
              filePath: file.path,
            },
          });
        }
      }
    }

    // Add annotation for active comment input
    if (activeCommentLine) {
      annotations.push({
        lineNumber: activeCommentLine.lineNumber,
        side: activeCommentLine.side,
        metadata: {
          type: "comment-input",
          lineNumber: activeCommentLine.lineNumber,
          side: activeCommentLine.side,
          fileId,
          filePath: file.path,
          onClose: onCloseActiveComment,
        },
      });
    }

    return annotations;
  }, [lineComments, activeCommentLine, fileId, file.path, onCloseActiveComment]);

  // Handle click on the built-in gutter utility button.
  const handleGutterUtilityClick = useCallback(
    (range: { start: number; side?: "deletions" | "additions" }) => {
      if (!onAddLineComment) return;

      const side = range.side ?? "additions";

      // Don't open a duplicate editor for the same line.
      if (activeCommentLine?.lineNumber === range.start && activeCommentLine?.side === side) {
        return;
      }

      // Don't open a new editor where a saved comment already exists.
      const commentKey = `${range.start}:${side}`;
      if (lineComments?.has(commentKey)) {
        return;
      }

      onAddLineComment(range.start, side);
    },
    [onAddLineComment, activeCommentLine, lineComments],
  );

  // Render inline annotations (comments and comment input)
  const handleRenderAnnotation = useCallback(
    (annotation: { metadata: LineCommentAnnotation }) => {
      const data = annotation.metadata;
      if (data.type === "comment-input") {
        const commentKey = `${data.lineNumber}:${data.side}`;
        const currentText = lineComments?.get(commentKey) ?? "";
        const handleClose = () => preserveContainerScroll(data.onClose ?? (() => {}));
        return (
          <InlineCommentInput
            lineNumber={data.lineNumber}
            filePath={data.filePath}
            text={currentText}
            onChange={(text) => {
              onUpdateLineComment?.(data.lineNumber, data.side, text);
            }}
            onClose={handleClose}
          />
        );
      }
      if (data.type === "comment" && data.text) {
        const handleEditClick = () => {
          onEditLineComment?.(data.lineNumber, data.side);
        };
        return <InlineSavedComment text={data.text} onClick={handleEditClick} />;
      }
      return null;
    },
    [lineComments, onUpdateLineComment, onEditLineComment, preserveContainerScroll],
  );

  if (parsed.error) {
    return (
      <div className="git-diff-file-view__empty" role="status" aria-live="polite">
        Unable to render diff: {parsed.error}
      </div>
    );
  }

  if (!parsed.fileDiff) {
    return <div className="git-diff-file-view__empty">(No patch body available for this file)</div>;
  }

  const options = useMemo<FileDiffProps<LineCommentAnnotation>["options"]>(
    () => ({
      diffStyle: displayOptions.viewMode,
      expandUnchanged: false,
      collapsedContextThreshold: 5,
      expansionLineCount: 20,
      hunkSeparators: "line-info",
      lineDiffType: "word",
      diffIndicators: "bars",
      overflow: displayOptions.wordWrap ? "wrap" : "scroll",
      disableFileHeader: true,
      themeType: "system",
      theme: {
        light: "pierre-light",
        dark: "pierre-dark",
      },
      // Keep gutter comments enabled, but avoid extra hover line mutations.
      enableGutterUtility: true,
      lineHoverHighlight: "disabled",
      onGutterUtilityClick: handleGutterUtilityClick,
    }),
    [displayOptions.viewMode, displayOptions.wordWrap, handleGutterUtilityClick],
  );

  return (
    <div className="git-diff-file-view" data-view-mode={displayOptions.viewMode} ref={containerRef}>
      <RenderErrorBoundary>
        <FileDiff<LineCommentAnnotation>
          fileDiff={parsed.fileDiff}
          options={options}
          lineAnnotations={lineAnnotations}
          renderAnnotation={handleRenderAnnotation}
        />
      </RenderErrorBoundary>
    </div>
  );
}

export const GitDiffFileView = memo(
  GitDiffFileViewImpl,
  (prev, next) =>
    prev.file.fingerprint === next.file.fingerprint &&
    prev.file.patch === next.file.patch &&
    prev.file.oldContent === next.file.oldContent &&
    prev.file.newContent === next.file.newContent &&
    prev.displayOptions.viewMode === next.displayOptions.viewMode &&
    prev.displayOptions.showUnchanged === next.displayOptions.showUnchanged &&
    prev.displayOptions.wordWrap === next.displayOptions.wordWrap &&
    prev.onAddLineComment === next.onAddLineComment &&
    prev.activeCommentLine?.lineNumber === next.activeCommentLine?.lineNumber &&
    prev.activeCommentLine?.side === next.activeCommentLine?.side &&
    prev.lineComments === next.lineComments &&
    prev.onUpdateLineComment === next.onUpdateLineComment &&
    prev.onEditLineComment === next.onEditLineComment,
);
