import { useAtom } from "jotai";
import { getLineCommentAtom, lineCommentsByKeyAtom } from "../state/comments";

interface LineCommentInputProps {
  fileId: string;
  filePath: string;
  lineNumber: number;
  side: "deletions" | "additions";
  onClose: () => void;
}

export function LineCommentInput({ fileId, filePath, lineNumber, onClose }: LineCommentInputProps) {
  const commentKey = `${fileId}:${lineNumber}`;
  const [text, setText] = useAtom(getLineCommentAtom(fileId, lineNumber));

  const handleCancel = () => {
    // Clear the draft if empty
    if (!text.trim()) {
      setText("");
    }
    onClose();
  };

  return (
    <div className="line-comment-input">
      <div className="line-comment-input__header">
        <span className="line-comment-input__meta">
          Line {lineNumber} — {filePath}
        </span>
        <button
          className="line-comment-input__close"
          onClick={handleCancel}
          type="button"
          aria-label="Cancel comment"
        >
          ×
        </button>
      </div>
      <textarea
        className="line-comment-input__textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment on this line..."
        autoFocus
        rows={3}
      />
      <div className="line-comment-input__actions">
        <button
          className="line-comment-input__button line-comment-input__button--secondary"
          onClick={handleCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="line-comment-input__button line-comment-input__button--primary"
          onClick={onClose}
          disabled={!text.trim()}
          type="button"
        >
          Save
        </button>
      </div>
    </div>
  );
}

interface LineCommentListProps {
  fileId: string;
  filePath: string;
}

export function LineCommentList({ fileId, filePath }: LineCommentListProps) {
  const [lineComments] = useAtom(lineCommentsByKeyAtom);

  // Get all line comments for this file
  const fileLineComments = Object.entries(lineComments)
    .filter(([key, text]) => key.startsWith(`${fileId}:`) && text.trim())
    .map(([key, text]) => {
      const line = parseInt(key.split(":")[1] ?? "0", 10);
      return { line, text };
    })
    .sort((a, b) => a.line - b.line);

  if (fileLineComments.length === 0) {
    return null;
  }

  return (
    <div className="line-comment-list">
      {fileLineComments.map(({ line, text }) => (
        <div key={line} className="line-comment-item">
          <div className="line-comment-item__header">
            <span className="line-comment-item__line">Line {line}</span>
          </div>
          <div className="line-comment-item__text">{text}</div>
        </div>
      ))}
    </div>
  );
}
