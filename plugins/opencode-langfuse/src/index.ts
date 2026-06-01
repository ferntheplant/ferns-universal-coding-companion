import { LangfuseSpanProcessor } from "@langfuse/otel";
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

type LangfuseOptions = {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
  environment?: string;
  harness?: string;
};

interface GitContext {
  repo?: string;
  repoRemote?: string;
  gitBranch?: string;
  gitCommit?: string;
}

function gitSync(args: string[], cwd: string): string | undefined {
  try {
    return execFileSync("git", args, { cwd, timeout: 3000, encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function getGitContext(cwd: string): GitContext {
  const remote = gitSync(["remote", "get-url", "origin"], cwd);
  const branch = gitSync(["branch", "--show-current"], cwd);
  const commit = gitSync(["rev-parse", "--short", "HEAD"], cwd);
  const repo = remote
    ? (remote.match(/\/([^/]+?)(?:\.git)?$/)?.[1] ?? basename(cwd))
    : basename(cwd);
  return { repo, repoRemote: remote, gitBranch: branch, gitCommit: commit };
}

/**
 * Stamps every span with the shared base metadata schema so traces from all
 * harnesses (opencode, pi, codex, claude-code) are comparable in Langfuse.
 */
class HarnessAttributesProcessor implements SpanProcessor {
  constructor(
    private readonly inner: SpanProcessor,
    private readonly harness: string,
    private readonly gitCtx: GitContext,
    private readonly cwd: string,
    private readonly sessionIdRef: { current?: string },
  ) {}

  onStart(span: Span, parentContext: Context): void {
    span.setAttribute("langfuse.trace.metadata.harness", this.harness);
    span.setAttribute("langfuse.trace.metadata.cwd", this.cwd);
    if (this.gitCtx.repo) span.setAttribute("langfuse.trace.metadata.repo", this.gitCtx.repo);
    if (this.gitCtx.repoRemote) span.setAttribute("langfuse.trace.metadata.repoRemote", this.gitCtx.repoRemote);
    if (this.gitCtx.gitBranch) span.setAttribute("langfuse.trace.metadata.gitBranch", this.gitCtx.gitBranch);
    if (this.gitCtx.gitCommit) span.setAttribute("langfuse.trace.metadata.gitCommit", this.gitCtx.gitCommit);
    if (this.sessionIdRef.current) {
      span.setAttribute("langfuse.trace.metadata.sessionId", this.sessionIdRef.current);
    }

    const tags: string[] = [`harness:${this.harness}`];
    if (this.gitCtx.repo) tags.push(`repo:${this.gitCtx.repo}`);
    span.setAttribute("langfuse.trace.tags", tags);

    this.inner.onStart?.(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

export const LangfusePlugin: Plugin = async ({ client }, options?: PluginOptions) => {
  const opts = (options ?? {}) as LangfuseOptions;

  const publicKey = str(opts.publicKey) ?? process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = str(opts.secretKey) ?? process.env.LANGFUSE_SECRET_KEY;
  const baseUrl =
    str(opts.baseUrl) ?? process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com";
  const environment =
    str(opts.environment) ?? process.env.LANGFUSE_ENVIRONMENT ?? "development";
  const harness =
    str(opts.harness) ?? process.env.LANGFUSE_HARNESS ?? "opencode";

  const log = (level: "info" | "warn" | "error", message: string) => {
    client.app.log({
      body: { service: "langfuse-otel", level, message },
    });
  };

  if (!publicKey || !secretKey) {
    log(
      "warn",
      "Missing Langfuse publicKey/secretKey (plugin options or LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY env) — tracing disabled",
    );
    return {};
  }

  const cwd = process.cwd();
  const gitCtx = getGitContext(cwd);
  const sessionIdRef: { current?: string } = {};

  const processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl,
    environment,
  });

  const sdk = new NodeSDK({
    spanProcessors: [new HarnessAttributesProcessor(processor, harness, gitCtx, cwd, sessionIdRef)],
  });

  sdk.start();
  log(
    "info",
    `OTEL tracing initialized → ${baseUrl} (env=${environment}, harness=${harness}, repo=${gitCtx.repo ?? "unknown"})`,
  );

  return {
    config: async (config) => {
      if (!config.experimental?.openTelemetry) {
        log(
          "warn",
          "experimental.openTelemetry is disabled in opencode config — spans will not be emitted",
        );
      }
    },
    event: async ({ event }) => {
      // Capture session ID from opencode session events
      if (event && typeof event === "object" && "properties" in event) {
        const props = (event as { properties?: Record<string, unknown> }).properties;
        const id = props?.id ?? props?.sessionId;
        if (typeof id === "string" && id) {
          sessionIdRef.current = id;
        }
      }

      if (event.type === "session.idle") {
        log("info", "Flushing OTEL spans before idle");
        await processor.forceFlush();
      }
      if (event.type === "server.instance.disposed") {
        await sdk.shutdown();
      }
    },
  };
};

export default LangfusePlugin;
