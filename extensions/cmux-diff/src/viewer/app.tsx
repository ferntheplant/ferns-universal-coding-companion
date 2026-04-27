import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Toolbar } from "./components/toolbar";
import { Sidebar } from "./components/sidebar";
import { FilePanel } from "./components/file-panel";
import type { ViewerBootstrap } from "./state/atoms";
import type { ReviewPayload } from "../domain/types";
import { initializeViewerAtom, viewerErrorAtom, viewerLoadStateAtom } from "./state/atoms";
import { fetchReviewData } from "./lib/api";
import { sidebarOpenAtom } from "./state/ui";

interface AppProps {
  bootstrap: ViewerBootstrap;
  initialPayload?: ReviewPayload;
}

export function App({ bootstrap, initialPayload }: AppProps) {
  const initializeViewer = useSetAtom(initializeViewerAtom);
  const setLoadState = useSetAtom(viewerLoadStateAtom);
  const setError = useSetAtom(viewerErrorAtom);
  const loadState = useAtomValue(viewerLoadStateAtom);
  const error = useAtomValue(viewerErrorAtom);
  const sidebarOpen = useAtomValue(sidebarOpenAtom);

  useEffect(() => {
    let cancelled = false;

    initializeViewer({ bootstrap });
    if (initialPayload) {
      initializeViewer({ bootstrap, payload: initialPayload });
      return;
    }

    if (!bootstrap.token) {
      setLoadState("error");
      setError("Review token is missing from bootstrap payload.");
      return;
    }

    setLoadState("loading");
    fetchReviewData(bootstrap.token)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        initializeViewer({ bootstrap, payload });
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setLoadState("error");
        const message =
          loadError instanceof Error ? loadError.message : "Failed to load review data.";
        setError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap, initialPayload, initializeViewer, setError, setLoadState]);

  if (loadState === "loading" || loadState === "idle") {
    return <main className="viewer viewer--centered">Loading review...</main>;
  }

  if (loadState === "error") {
    return <main className="viewer viewer--centered">{error ?? "Failed to load viewer."}</main>;
  }

  return (
    <main className="viewer">
      <Toolbar />
      <div className={`viewer__layout${sidebarOpen ? "" : " viewer__layout--sidebar-collapsed"}`}>
        {sidebarOpen ? <Sidebar /> : null}
        <FilePanel />
      </div>
    </main>
  );
}
