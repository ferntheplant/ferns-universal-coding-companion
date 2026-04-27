import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  fileCountAtom,
  reviewStatusAtom,
  targetLabelAtom,
  submitUrlAtom,
  canSubmitAtom,
  submissionStateAtom,
  submissionErrorAtom,
  startSubmissionAtom,
  setSubmissionSuccessAtom,
  setSubmissionErrorAtom,
  reviewTokenAtom,
} from "../state/atoms";
import {
  totalDraftCommentCountAtom,
  buildSubmissionPayloadAtom,
  clearAllCommentsAtom,
} from "../state/comments";
import { reviewPayloadAtom } from "../state/atoms";
import { diffViewModeAtom, sidebarOpenAtom, wordWrapAtom } from "../state/ui";
import { submitReviewComments } from "../lib/api";

export function Toolbar() {
  const target = useAtomValue(targetLabelAtom);
  const status = useAtomValue(reviewStatusAtom);
  const fileCount = useAtomValue(fileCountAtom);
  const commentCount = useAtomValue(totalDraftCommentCountAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const [diffViewMode, setDiffViewMode] = useAtom(diffViewModeAtom);
  const [wordWrap, setWordWrap] = useAtom(wordWrapAtom);

  // Submission state
  const submitUrl = useAtomValue(submitUrlAtom);
  const canSubmit = useAtomValue(canSubmitAtom);
  const submissionState = useAtomValue(submissionStateAtom);
  const submissionError = useAtomValue(submissionErrorAtom);
  const token = useAtomValue(reviewTokenAtom);
  const payload = useAtomValue(reviewPayloadAtom);

  const startSubmission = useSetAtom(startSubmissionAtom);
  const setSubmissionSuccess = useSetAtom(setSubmissionSuccessAtom);
  const setSubmissionError = useSetAtom(setSubmissionErrorAtom);
  const buildPayload = useSetAtom(buildSubmissionPayloadAtom);
  const clearComments = useSetAtom(clearAllCommentsAtom);

  const handleSubmit = async () => {
    if (!submitUrl || !payload || !token) {
      setSubmissionError("Missing submission URL or payload.");
      return;
    }

    startSubmission();

    try {
      const submitPayload = buildPayload({
        files: payload.files.map((f) => ({ id: f.id, path: f.path })),
        reviewToken: token,
      });

      await submitReviewComments(submitUrl, submitPayload);

      setSubmissionSuccess();
      clearComments();

      // Attempt to auto-close the tab after successful submission
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // Ignore if auto-close is blocked
        }
      }, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Submission failed.";
      setSubmissionError(message);
    }
  };

  const getSubmitButtonText = () => {
    switch (submissionState) {
      case "submitting":
        return "Submitting...";
      case "success":
        return "Submitted!";
      case "error":
        return "Retry Submit";
      default:
        return `Submit Review (${commentCount})`;
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar__title">cmux-diff</div>

      <button
        className="toolbar__toggle"
        type="button"
        onClick={() => setSidebarOpen((value) => !value)}
        aria-pressed={sidebarOpen}
      >
        {sidebarOpen ? "Hide files" : "Show files"}
      </button>

      <button
        className="toolbar__toggle"
        type="button"
        onClick={() => setDiffViewMode((value) => (value === "split" ? "unified" : "split"))}
        aria-pressed={diffViewMode === "split"}
      >
        {diffViewMode === "split" ? "Disable side-by-side" : "Enable side-by-side"}
      </button>

      <button
        className="toolbar__toggle"
        type="button"
        onClick={() => setWordWrap((value) => !value)}
        aria-pressed={wordWrap}
      >
        {wordWrap ? "Disable word wrap" : "Enable word wrap"}
      </button>

      <div className="toolbar__meta">{target}</div>
      <div className="toolbar__meta">{fileCount} files</div>
      <div className="toolbar__meta">{commentCount} draft comments</div>
      <div className="toolbar__status" data-status={status}>
        {status}
      </div>

      <button
        className={`toolbar__submit toolbar__submit--${submissionState}`}
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || commentCount === 0}
        aria-busy={submissionState === "submitting"}
      >
        {getSubmitButtonText()}
      </button>

      {submissionState === "success" && (
        <div className="toolbar__message toolbar__message--success">
          Comments submitted to Pi. You can close this tab.
        </div>
      )}

      {submissionState === "error" && submissionError && (
        <div className="toolbar__message toolbar__message--error">{submissionError}</div>
      )}
    </header>
  );
}
