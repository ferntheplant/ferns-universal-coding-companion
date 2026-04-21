import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const VIEWER_DIR = join(CURRENT_DIR, "..", "viewer");
const VIEWER_MAIN_ENTRY = join(VIEWER_DIR, "main.tsx");
const VIEWER_CSS_PATH = join(VIEWER_DIR, "styles.css");

let bundledViewerJs: string | undefined;
let bundledViewerJsCreatedAt = 0;

async function buildViewerJsBundleWithBunApi(): Promise<string> {
  if (typeof Bun === "undefined" || typeof Bun.build !== "function") {
    throw new Error("Bun.build is unavailable");
  }

  const result = await Bun.build({
    entrypoints: [VIEWER_MAIN_ENTRY],
    target: "browser",
    format: "esm",
    minify: false,
    splitting: false,
    sourcemap: "none",
    packages: "bundle",
  });

  if (!result.success || result.outputs.length === 0) {
    const firstLog = result.logs[0];
    const message = firstLog ? `${firstLog.name}: ${firstLog.message}` : "Unknown Bun.build error";
    throw new Error(`Failed to build viewer bundle: ${message}`);
  }

  const jsOutput = result.outputs.find((output) => output.path.endsWith(".js"));
  if (!jsOutput) {
    throw new Error("Viewer bundle did not produce a JavaScript output");
  }

  return await jsOutput.text();
}

async function buildViewerJsBundleWithBunCli(): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "cmux-diff-viewer-"));
  const outFile = join(outDir, "viewer.js");

  const findFirstJsFile = async (dir: string): Promise<string | undefined> => {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findFirstJsFile(entryPath);
        if (nested) {
          return nested;
        }
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".js")) {
        return entryPath;
      }
    }

    return undefined;
  };

  try {
    await execFileAsync("bun", [
      "build",
      VIEWER_MAIN_ENTRY,
      "--target",
      "browser",
      "--format",
      "esm",
      "--outdir",
      outDir,
    ]);
    const builtJsPath = await findFirstJsFile(outDir);
    if (!builtJsPath) {
      throw new Error("bun CLI build did not produce a JavaScript output");
    }
    return await readFile(builtJsPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bun CLI error";
    throw new Error(`Failed to build viewer bundle with bun CLI: ${message}`);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

async function buildViewerJsBundle(): Promise<string> {
  try {
    return await buildViewerJsBundleWithBunApi();
  } catch {
    return buildViewerJsBundleWithBunCli();
  }
}

async function getBundledViewerJs(): Promise<string> {
  if (bundledViewerJs) {
    return bundledViewerJs;
  }

  bundledViewerJs = await buildViewerJsBundle();
  bundledViewerJsCreatedAt = Date.now();
  return bundledViewerJs;
}

async function getViewerCss(): Promise<string> {
  return readFile(VIEWER_CSS_PATH, "utf8");
}

export function clearViewerAssetCache(): void {
  bundledViewerJs = undefined;
  bundledViewerJsCreatedAt = 0;
}

export function getViewerAssetCacheStatus(): { hasJsBundle: boolean; bundledAt?: number } {
  return {
    hasJsBundle: Boolean(bundledViewerJs),
    bundledAt: bundledViewerJsCreatedAt || undefined,
  };
}

export async function handleViewerAssetRequest(pathname: string): Promise<Response | undefined> {
  if (pathname === "/assets/viewer.js") {
    try {
      const source = await getBundledViewerJs();
      return new Response(source, {
        status: 200,
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_viewer_bundle_error";
      return new Response(`cmux-diff asset error: ${message}`, {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  }

  if (pathname === "/assets/viewer.css") {
    try {
      const css = await getViewerCss();
      return new Response(css, {
        status: 200,
        headers: {
          "content-type": "text/css; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_viewer_css_error";
      return new Response(`cmux-diff asset error: ${message}`, {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  }

  return undefined;
}
