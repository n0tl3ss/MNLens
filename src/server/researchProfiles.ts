import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrDetail, SourceLink } from "../shared/types.js";
import { cacheDir } from "./paths.js";

/**
 * Research profiles.
 *
 * A profile describes a technology area MNLens knows how to research well:
 * what in a PR triggers it, which GitHub code-search queries find comparable
 * implementations, hand-curated reference sources, how to weight relevance,
 * and extra guidance for the analysis prompt.
 *
 * Profiles are plain data so teams can add their own without touching the
 * analysis code. Built-in profiles live below; user profiles are read from
 * `<cache>/research-profiles.json` (an array of {@link ResearchProfile}) and
 * from MNLENS_RESEARCH_PROFILES_JSON. A user profile with the same `id`
 * replaces the built-in one; set `"enabled": false` to switch one off.
 */
export interface ResearchProfile {
  id: string;
  title: string;
  enabled?: boolean;
  /** Lower-cased substrings; the profile applies when any appears in title/body/paths/diff. */
  triggers: string[];
  /** GitHub code search queries, tried in order until enough candidates exist. */
  codeSearchQueries: string[];
  /** Terms (regex source, case-insensitive) whose presence in a path/snippet marks an exact API match. */
  exactMatchTerms: string[];
  /** Relevance weights applied to candidate text when ranking sources. */
  relevanceTerms: Array<{ term: string; weight: number }>;
  /** Hand-picked sources always offered as candidates. */
  curatedSources: SourceLink[];
  /** Extra behavior rule(s) appended to the analysis prompt while this profile is active. */
  promptGuidance: string[];
  /** Human-readable description used in generated reason/comparison text. */
  subject: string;
}

const builtInProfiles: ResearchProfile[] = [
  {
    id: "oracle-ucp-opentelemetry",
    title: "Oracle UCP OpenTelemetry instrumentation",
    subject: "Oracle UCP/OpenTelemetry lifecycle",
    triggers: ["oracleucptelemetry", "oracle ucp", "universalconnectionpool", "opentelemetry-oracle-ucp", "ucp.enabled"],
    codeSearchQueries: [
      '"UCPTelemetry" "OracleUcpTelemetry" owner:oracle',
      '"OracleUcpTelemetry" "cloudbank"',
      '"OracleUcpTelemetry" "registerMetrics"',
      '"OracleUcpTelemetry" "UniversalConnectionPool"',
      '"OracleUcpTelemetry.create"',
      '"opentelemetry-oracle-ucp-11.2"'
    ],
    exactMatchTerms: ["OracleUcpTelemetry", "UniversalConnectionPool", "registerMetrics", "unregisterMetrics"],
    relevanceTerms: [
      { term: "oracleucptelemetry", weight: 10 },
      { term: "universalconnectionpool", weight: 8 },
      { term: "registermetrics", weight: 6 },
      { term: "unregistermetrics", weight: 6 },
      { term: "oracle ucp", weight: 5 },
      { term: "oracle-ucp", weight: 5 },
      { term: "opentelemetry", weight: 2 },
      { term: "micronaut", weight: 2 },
      { term: "spring", weight: 1 },
      { term: "quarkus", weight: 1 },
      { term: "micrometer", weight: 1 }
    ],
    curatedSources: [
      {
        title: "Oracle CloudBank UCPTelemetry",
        url: "https://github.com/oracle/microservices-datadriven/blob/main/cloudbank-v5/common/src/main/java/com/example/common/ucp/UCPTelemetry.java",
        reason: "Known Oracle example that wraps OpenTelemetry Oracle UCP telemetry in an application-specific UCPTelemetry helper.",
        framework: "Oracle example application",
        repository: "oracle/microservices-datadriven",
        filePath: "cloudbank-v5/common/src/main/java/com/example/common/ucp/UCPTelemetry.java",
        codeSnippet: `private OpenTelemetry openTelemetry;

public UCPTelemetry(OpenTelemetry openTelemetry) {
    this.ucpTelemetry = OracleUcpTelemetry.create(openTelemetry);
    this.openTelemetry = openTelemetry;
}`,
        snippetSourceUrl: "https://github.com/oracle/microservices-datadriven/blob/main/cloudbank-v5/common/src/main/java/com/example/common/ucp/UCPTelemetry.java",
        comparison: "Shows the same OracleUcpTelemetry construction pattern that a framework integration automates through bean lifecycle hooks.",
        caveat: "Use it as an Oracle UCP telemetry usage reference, not as evidence that framework lifecycle registration, unregister behavior, or metric attributes are correct."
      }
    ],
    promptGuidance: [
      "For Oracle UCP, JDBC, datasource, or tracing PRs, explicitly look for Oracle UCP/OpenTelemetry instrumentation examples and comparable Spring/Quarkus/Micrometer support, then compare semantic attributes, span names, lifecycle hooks, wrappers/proxies, error handling, and test coverage against the PR. Prioritize sources that mention OracleUcpTelemetry, UniversalConnectionPool, registerMetrics, or unregisterMetrics. Treat generic OpenTelemetry instrumentation examples as lower relevance unless they directly explain the same lifecycle or metric signal."
    ]
  },
  {
    id: "framework-instrumentation",
    title: "Framework instrumentation / telemetry integrations",
    subject: "framework instrumentation",
    triggers: ["opentelemetry", "micrometer", "tracing", "instrumentation", "telemetry", "meterregistry", "span "],
    codeSearchQueries: [],
    exactMatchTerms: ["Tracer", "Meter", "Span", "Instrumentation"],
    relevanceTerms: [
      { term: "opentelemetry", weight: 4 },
      { term: "micrometer", weight: 3 },
      { term: "instrumentation", weight: 3 },
      { term: "semantic", weight: 2 }
    ],
    curatedSources: [],
    promptGuidance: [
      "For instrumentation, telemetry, messaging, database, or library-support PRs, research comparable implementations in mature projects before filling similarImplementations. Prefer the current ecosystem first, then comparable frameworks such as Spring, Quarkus, OpenTelemetry instrumentation, Micrometer, or official examples."
    ]
  },
  {
    id: "dependency-vulnerability",
    title: "Dependency / CVE updates",
    subject: "dependency vulnerability remediation",
    triggers: ["cve-", "vulnerab", "ghsa-", "security advisory", "dependabot", "renovate"],
    codeSearchQueries: [],
    exactMatchTerms: [],
    relevanceTerms: [
      { term: "cve", weight: 5 },
      { term: "advisory", weight: 3 },
      { term: "bom", weight: 2 }
    ],
    curatedSources: [],
    promptGuidance: [
      "For dependency or CVE PRs, identify the vulnerable artifact and the root dependency/BOM/platform that pulls it in. Prefer evidence that the root dependency was updated over a pinned transitive version, and call out whether the fixed version is actually released and compatible."
    ]
  }
];

let cache: { loadedAt: number; profiles: ResearchProfile[] } | undefined;
const cacheTtlMs = 30_000;

export async function loadResearchProfiles(): Promise<ResearchProfile[]> {
  if (cache && Date.now() - cache.loadedAt < cacheTtlMs) return cache.profiles;
  const overrides = [...(await readProfileFile()), ...parseEnvProfiles()];
  const byId = new Map<string, ResearchProfile>(builtInProfiles.map((profile) => [profile.id, profile]));
  for (const override of overrides) {
    if (!override || typeof override !== "object" || typeof override.id !== "string") continue;
    const base = byId.get(override.id);
    byId.set(override.id, normalizeProfile({ ...(base ?? emptyProfile(override.id)), ...override }));
  }
  const profiles = [...byId.values()].filter((profile) => profile.enabled !== false);
  cache = { loadedAt: Date.now(), profiles };
  return profiles;
}

/** Test hook. */
export function resetResearchProfileCache(): void {
  cache = undefined;
}

export function matchingProfiles(detail: Pick<PrDetail, "title" | "body" | "files" | "diff">, profiles: ResearchProfile[], maxDiffChars = 70_000): ResearchProfile[] {
  const text = `${detail.title}\n${detail.body}\n${detail.files.map((file) => file.path).join("\n")}\n${detail.diff.slice(0, maxDiffChars)}`.toLowerCase();
  return profiles.filter((profile) => profile.triggers.some((trigger) => trigger && text.includes(trigger.toLowerCase())));
}

export function profileRelevance(text: string, profiles: ResearchProfile[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const profile of profiles) {
    for (const { term, weight } of profile.relevanceTerms) {
      if (lower.includes(term.toLowerCase())) score += weight;
    }
  }
  return score;
}

export function exactMatchPattern(profiles: ResearchProfile[]): RegExp | undefined {
  const terms = profiles.flatMap((profile) => profile.exactMatchTerms).filter(Boolean);
  if (terms.length === 0) return undefined;
  return new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
}

function emptyProfile(id: string): ResearchProfile {
  return { id, title: id, subject: id, triggers: [], codeSearchQueries: [], exactMatchTerms: [], relevanceTerms: [], curatedSources: [], promptGuidance: [] };
}

function normalizeProfile(profile: ResearchProfile): ResearchProfile {
  return {
    ...profile,
    triggers: Array.isArray(profile.triggers) ? profile.triggers.map(String) : [],
    codeSearchQueries: Array.isArray(profile.codeSearchQueries) ? profile.codeSearchQueries.map(String) : [],
    exactMatchTerms: Array.isArray(profile.exactMatchTerms) ? profile.exactMatchTerms.map(String) : [],
    relevanceTerms: Array.isArray(profile.relevanceTerms) ? profile.relevanceTerms.filter((item) => item && typeof item.term === "string" && typeof item.weight === "number") : [],
    curatedSources: Array.isArray(profile.curatedSources) ? profile.curatedSources : [],
    promptGuidance: Array.isArray(profile.promptGuidance) ? profile.promptGuidance.map(String) : [],
    subject: profile.subject || profile.title || profile.id
  };
}

async function readProfileFile(): Promise<ResearchProfile[]> {
  try {
    const parsed = JSON.parse(await readFile(join(cacheDir, "research-profiles.json"), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as ResearchProfile[]) : [];
  } catch {
    return [];
  }
}

function parseEnvProfiles(): ResearchProfile[] {
  const raw = process.env.MNLENS_RESEARCH_PROFILES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ResearchProfile[]) : [];
  } catch {
    return [];
  }
}
