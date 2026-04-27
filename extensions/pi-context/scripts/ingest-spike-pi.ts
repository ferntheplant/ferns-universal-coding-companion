import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

interface CliOptions {
  inputPath: string;
  ingestUrl: string;
  resetFirst: boolean;
}

const DEFAULT_INPUT = "tmp";
const DEFAULT_INGEST_URL = "http://127.0.0.1:4041/api/ingest/pi";

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/ingest-spike-pi.ts [options]

Options:
  --input <path>       Spike root, session dir, or single fixture json. Default: ${DEFAULT_INPUT}
  --ingest-url <url>   Pi ingest endpoint. Default: ${DEFAULT_INGEST_URL}
  --reset-first        POST /api/reset before ingesting
  --help               Show this help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: DEFAULT_INPUT,
    ingestUrl: DEFAULT_INGEST_URL,
    resetFirst: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--reset-first") {
      options.resetFirst = true;
      continue;
    }
    if (arg === "--input" || arg === "-i") {
      options.inputPath = argv[index + 1] ?? options.inputPath;
      index += 1;
      continue;
    }
    if (arg === "--ingest-url") {
      options.ingestUrl = argv[index + 1] ?? options.ingestUrl;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function listJsonFiles(targetPath: string): Promise<string[]> {
  const resolved = resolve(targetPath);
  const targetStat = await stat(resolved);

  if (targetStat.isFile()) {
    return extname(resolved) === ".json" ? [resolved] : [];
  }

  const entries = await readdir(resolved, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(resolved, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === ".json") {
      files.push(fullPath);
    }
  }
  return files;
}

async function maybeResetContextLens(ingestUrl: string): Promise<void> {
  const resetUrl = new URL(ingestUrl);
  resetUrl.pathname = "/api/reset";
  const response = await fetch(resetUrl, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Reset failed: ${response.status} ${response.statusText}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = await listJsonFiles(options.inputPath);
  if (files.length === 0) {
    throw new Error(`No json fixtures found under ${options.inputPath}`);
  }

  files.sort((left, right) => left.localeCompare(right));

  if (options.resetFirst) {
    await maybeResetContextLens(options.ingestUrl);
  }

  let ingested = 0;
  for (const filePath of files) {
    const payload = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const response = await fetch(options.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ingest failed for ${filePath}: ${response.status} ${response.statusText} ${body}`);
    }

    ingested += 1;
  }

  console.log(
    JSON.stringify(
      {
        ingestUrl: options.ingestUrl,
        files: files.length,
        ingested,
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
