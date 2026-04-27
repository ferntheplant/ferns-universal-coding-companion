import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import matter from "gray-matter";
import { isValidModelSelector, matchesModelSelector, modelPromptsDir } from "./paths";

export interface PromptFragment {
  path: string;
  description?: string;
  selectors: string[];
  content: string;
}

export interface ResolvedPromptSet {
  modelKey: string;
  fragments: PromptFragment[];
  combinedContent: string;
}

export interface PromptRegistrySnapshot {
  promptDir: string;
  cached: boolean;
  fragmentCount: number;
  lastScanAt?: number;
  fingerprint?: string;
  warnings: string[];
}

interface ScanResult {
  fragments: PromptFragment[];
  warnings: string[];
  fingerprint: string;
  scannedAt: number;
}

export class PromptRegistry {
  private fragments: PromptFragment[] = [];
  private warnings: string[] = [];
  private lastScanAt?: number;
  private fingerprint?: string;
  private cached = false;

  async ensureFresh(): Promise<void> {
    const nextFingerprint = await this.computeFingerprint();

    if (this.cached && nextFingerprint === this.fingerprint) {
      return;
    }

    const scan = await this.scanPromptDirectory(nextFingerprint);
    this.fragments = scan.fragments;
    this.warnings = scan.warnings;
    this.lastScanAt = scan.scannedAt;
    this.fingerprint = scan.fingerprint;
    this.cached = true;
  }

  resolvePromptSet(modelKey: string): ResolvedPromptSet {
    const fragments = this.fragments.filter((fragment) =>
      fragment.selectors.some((selector) => matchesModelSelector(modelKey, selector)),
    );

    return {
      modelKey,
      fragments,
      combinedContent: fragments
        .map((fragment) => fragment.content)
        .join("\n\n")
        .trim(),
    };
  }

  getSnapshot(): PromptRegistrySnapshot {
    return {
      promptDir: modelPromptsDir,
      cached: this.cached,
      fragmentCount: this.fragments.length,
      lastScanAt: this.lastScanAt,
      fingerprint: this.fingerprint,
      warnings: [...this.warnings],
    };
  }

  reset(): void {
    this.fragments = [];
    this.warnings = [];
    this.lastScanAt = undefined;
    this.fingerprint = undefined;
    this.cached = false;
  }

  private async computeFingerprint(): Promise<string> {
    try {
      const dirStat = await stat(modelPromptsDir);
      const entries = await readdir(modelPromptsDir, { withFileTypes: true });
      const promptFileNames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      const fileParts = await Promise.all(
        promptFileNames.map(async (fileName) => {
          const filePath = join(modelPromptsDir, fileName);
          const fileStat = await stat(filePath);
          return `${fileName}:${fileStat.size}:${fileStat.mtimeMs}`;
        }),
      );

      return JSON.stringify({
        dirMtimeMs: dirStat.mtimeMs,
        files: fileParts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `missing:${message}`;
    }
  }

  private async scanPromptDirectory(fingerprint: string): Promise<ScanResult> {
    const warnings: string[] = [];
    const fragments: PromptFragment[] = [];
    const scannedAt = Date.now();

    try {
      const entries = await readdir(modelPromptsDir, { withFileTypes: true });
      const promptFileNames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      for (const fileName of promptFileNames) {
        const filePath = join(modelPromptsDir, fileName);
        const result = await this.readPromptFile(filePath);
        warnings.push(...result.warnings);

        if (result.fragment) {
          fragments.push(result.fragment);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to scan ${modelPromptsDir}: ${message}`);
    }

    return {
      fragments,
      warnings,
      fingerprint,
      scannedAt,
    };
  }

  private async readPromptFile(
    filePath: string,
  ): Promise<{ fragment?: PromptFragment; warnings: string[] }> {
    const warnings: string[] = [];
    const fileName = basename(filePath);

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      const modelsValue = data.models;
      const descriptionValue = data.description;

      if (!Array.isArray(modelsValue)) {
        warnings.push(`Skipped ${fileName}: frontmatter must include models: string[]`);
        return { warnings };
      }

      const selectors = modelsValue.filter((value): value is string => typeof value === "string");
      const validSelectors = selectors.filter((selector) => isValidModelSelector(selector));
      const invalidSelectors = selectors.filter((selector) => !isValidModelSelector(selector));

      for (const selector of invalidSelectors) {
        warnings.push(`Skipped selector in ${fileName}: ${selector}`);
      }

      if (validSelectors.length === 0) {
        warnings.push(`Skipped ${fileName}: no valid model selectors`);
        return { warnings };
      }

      const content = parsed.content.trim();
      if (content.length === 0) {
        warnings.push(`Skipped ${fileName}: prompt body is empty`);
        return { warnings };
      }

      const description = typeof descriptionValue === "string" ? descriptionValue : undefined;

      return {
        fragment: {
          path: filePath,
          description,
          selectors: validSelectors,
          content,
        },
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to parse ${fileName}: ${message}`);
      return { warnings };
    }
  }
}
