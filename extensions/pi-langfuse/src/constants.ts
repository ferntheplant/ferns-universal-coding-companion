import { homedir } from "node:os";
import { resolve } from "node:path";

export const CONFIG_DIR = resolve(homedir(), ".pi", "agent", "pi-langfuse");
export const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");
export const DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com";

export const MAX_STRING_LENGTH = 4_000;
export const MAX_TOOL_PAYLOAD_LENGTH = 8_000;
export const MAX_DEPTH = 6;
export const MAX_ARRAY_ITEMS = 20;
export const MAX_OBJECT_KEYS = 80;
export const MAX_PAYLOAD_NODES = 500;

export const REST_FALLBACK_CHUNK_SIZE = 25;
