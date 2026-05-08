import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const defaultCacheDir = process.env.MNLENS_CACHE_DIR || join(sourceRoot.includes(".asar") ? process.cwd() : sourceRoot, ".pra-cache");
export const projectRoot =
  process.env.MNLENS_WORK_DIR ||
  (sourceRoot.includes(".asar") ? defaultCacheDir : existsSync(join(process.cwd(), "package.json")) ? process.cwd() : sourceRoot);
export const cacheDir = defaultCacheDir;
export const codexSchemaPath = join(cacheDir, "analysis.schema.json");
