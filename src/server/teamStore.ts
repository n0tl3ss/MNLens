import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { TeamSettings, TeamStatus, UpdateTeamSettingsRequest } from "../shared/types.js";
import { cacheDir } from "./paths.js";

/**
 * Team store.
 *
 * MNLens is local-first, but repo rules and review memory are more valuable
 * when a team shares them: one reviewer's "we dismissed this 4x" should
 * calibrate everyone's prompts. Rather than a server, the team store is a
 * plain folder the team already shares — a git checkout, Dropbox / iCloud,
 * or a network drive — set once under *Team sharing* or `MNLENS_TEAM_DIR`.
 *
 * Layout: `<dir>/<owner>__<repo>/rules.json` (one file, written whole) and
 * `<dir>/<owner>__<repo>/memory/<member>.json` (one file per machine, merged
 * on read) so two reviewers never overwrite each other's verdicts.
 *
 * Nothing here is required: with no folder configured every read/write falls
 * back to the local cache exactly as before.
 */

const settingsPath = join(cacheDir, "team-settings.json");

export async function readTeamSettings(): Promise<TeamSettings> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as Partial<TeamSettings>;
    return { dir: typeof parsed.dir === "string" && parsed.dir.trim() ? parsed.dir : undefined, updatedAt: parsed.updatedAt ?? new Date(0).toISOString() };
  } catch {
    return { updatedAt: new Date(0).toISOString() };
  }
}

export async function updateTeamSettings(patch: UpdateTeamSettingsRequest): Promise<TeamStatus> {
  const current = await readTeamSettings();
  let dir = current.dir;
  if (patch.dir === null) dir = undefined;
  else if (typeof patch.dir === "string") {
    const trimmed = patch.dir.trim();
    if (trimmed && !isAbsolute(expandHome(trimmed))) throw new Error("Team folder must be an absolute path.");
    dir = trimmed ? resolve(expandHome(trimmed)) : undefined;
  }
  if (dir) await mkdir(dir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify({ dir, updatedAt: new Date().toISOString() } satisfies TeamSettings, null, 2));
  return teamStatus();
}

/** Resolved team folder: env override wins so a team can ship a launcher that sets it. */
export async function teamDir(): Promise<{ dir?: string; source: TeamStatus["source"] }> {
  const env = process.env.MNLENS_TEAM_DIR?.trim();
  if (env) return { dir: resolve(expandHome(env)), source: "env" };
  const settings = await readTeamSettings();
  return settings.dir ? { dir: settings.dir, source: "settings" } : { source: "none" };
}

export async function teamStatus(): Promise<TeamStatus> {
  const { dir, source } = await teamDir();
  const status: TeamStatus = { dir, source, exists: false, writable: false, memberId: memberId(), repositories: [] };
  if (!dir) return status;
  try {
    await access(dir, constants.R_OK);
    status.exists = true;
    await access(dir, constants.W_OK);
    status.writable = true;
    status.repositories = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.includes("__"))
      .map((entry) => entry.name.replace("__", "/"))
      .sort();
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }
  return status;
}

let cachedMemberId: string | undefined;

/**
 * Stable per-machine id used as the memory file name; no secrets, just enough
 * to avoid collisions. `user@host` when the host name is a real name; when it
 * is an IP address or empty (common on laptops that roam networks) a random
 * suffix is generated once and kept in the cache so the id never churns.
 * `MNLENS_MEMBER_ID` overrides it (e.g. your GitHub login) for a nicer file name.
 */
export function memberId(): string {
  if (cachedMemberId) return cachedMemberId;
  cachedMemberId = computeMemberId(process.env.MNLENS_MEMBER_ID);
  return cachedMemberId;
}

export function computeMemberId(override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed.replace(/[^a-zA-Z0-9_.@-]/g, "_").slice(0, 80);
  const user = (() => {
    try {
      return userInfo().username;
    } catch {
      return "user";
    }
  })();
  let host = hostname().split(".")[0];
  if (!host || /^\d+(-\d+){3}$|^\d+$|^[0-9a-f:]+$/i.test(host.replace(/\./g, "-"))) host = stableMachineSuffix();
  return `${user}@${host}`.replace(/[^a-zA-Z0-9_.@-]/g, "_").slice(0, 80);
}

function stableMachineSuffix(): string {
  const file = join(cacheDir, "member-id");
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, "utf8").trim();
      if (stored) return stored;
    }
    const generated = `machine-${randomBytes(3).toString("hex")}`;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, generated);
    return generated;
  } catch {
    return "machine";
  }
}

export function repositoryFolder(repository: string): string {
  return repository.replace(/[^a-zA-Z0-9_.-]/g, "__");
}

export async function readTeamJson<T>(repository: string, file: string): Promise<T | undefined> {
  const { dir } = await teamDir();
  if (!dir) return undefined;
  try {
    return JSON.parse(await readFile(join(dir, repositoryFolder(repository), file), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function writeTeamJson(repository: string, file: string, value: unknown): Promise<boolean> {
  const { dir } = await teamDir();
  if (!dir) return false;
  const folder = join(dir, repositoryFolder(repository), ...file.split("/").slice(0, -1));
  await mkdir(folder, { recursive: true });
  await writeFile(join(dir, repositoryFolder(repository), file), JSON.stringify(value, null, 2));
  return true;
}

/** Every member's memory file for a repository, merged; undefined when no team folder is configured. */
export async function readTeamMemoryFiles<T>(repository: string): Promise<{ member: string; entries: T[] }[] | undefined> {
  const { dir } = await teamDir();
  if (!dir) return undefined;
  const folder = join(dir, repositoryFolder(repository), "memory");
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const files: { member: string; entries: T[] }[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(join(folder, name), "utf8")) as unknown;
      files.push({ member: name.replace(/\.json$/, ""), entries: Array.isArray(parsed) ? (parsed as T[]) : [] });
    } catch {
      // Skip unreadable member files; a half-synced file must not break everyone.
    }
  }
  return files;
}

function expandHome(value: string): string {
  if (value === "~" || value.startsWith("~/")) return join(process.env.HOME ?? process.env.USERPROFILE ?? "", value.slice(1));
  return value;
}
