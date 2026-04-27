import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type PrivacyLevel = "minimal" | "standard" | "full";
type ExportFormat = "lhar" | "lhar.json";

interface CliOptions {
  baseUrl: string;
  format: ExportFormat;
  conversation: string | null;
  privacy: PrivacyLevel | null;
  outputPath: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: "http://127.0.0.1:4041",
    format: "lhar.json",
    conversation: null,
    privacy: null,
    outputPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      options.baseUrl = argv[i + 1] ?? options.baseUrl;
      i += 1;
      continue;
    }
    if (arg === "--format") {
      const value = (argv[i + 1] ?? options.format) as ExportFormat;
      if (value !== "lhar" && value !== "lhar.json") {
        throw new Error(`Invalid --format value: ${value}`);
      }
      options.format = value;
      i += 1;
      continue;
    }
    if (arg === "--conversation") {
      options.conversation = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--privacy") {
      const value = (argv[i + 1] ?? "") as PrivacyLevel;
      if (value !== "minimal" && value !== "standard" && value !== "full") {
        throw new Error(`Invalid --privacy value: ${value}`);
      }
      options.privacy = value;
      i += 1;
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      options.outputPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/export-lhar.ts [options]

Options:
  --format <lhar|lhar.json>      Export format. Default: lhar.json
  --conversation <id>            Optional conversation id filter
  --privacy <minimal|standard|full>
                                 Optional privacy override (otherwise sidecar default)
  --output <path>                Output file path
  --base-url <url>               Sidecar base URL. Default: http://127.0.0.1:4041
  --help                         Show help
`);
}

function defaultOutputPath(format: ExportFormat): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = format === "lhar" ? "lhar" : "lhar.json";
  return join(homedir(), ".pi-context", "exports", `pi-context-${stamp}.${ext}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = resolve(options.outputPath ?? defaultOutputPath(options.format));

  const endpoint = options.format === "lhar" ? "/api/export/lhar" : "/api/export/lhar.json";
  const url = new URL(endpoint, options.baseUrl);
  if (options.conversation) {
    url.searchParams.set("conversation", options.conversation);
  }
  if (options.privacy) {
    url.searchParams.set("privacy", options.privacy);
  }

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Export failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
    );
  }

  const data = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, data);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        format: options.format,
        conversation: options.conversation,
        privacy: options.privacy,
        bytes: data.byteLength,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
