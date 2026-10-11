import { afterEach, describe, expect, it } from "vitest";
import { exactMatchPattern, loadResearchProfiles, matchingProfiles, profileRelevance, resetResearchProfileCache } from "../src/server/researchProfiles.js";

const detail = (text: string) => ({ title: text, body: "", files: [{ path: "src/Main.java", additions: 1, deletions: 0 }], diff: "" });

describe("research profiles", () => {
  afterEach(() => {
    delete process.env.MNLENS_RESEARCH_PROFILES_JSON;
    resetResearchProfileCache();
  });

  it("ships built-in profiles and matches them by trigger text", async () => {
    const profiles = await loadResearchProfiles();
    expect(profiles.map((profile) => profile.id)).toContain("oracle-ucp-opentelemetry");
    expect(matchingProfiles(detail("Add OracleUcpTelemetry registration"), profiles).map((profile) => profile.id)).toContain("oracle-ucp-opentelemetry");
    expect(matchingProfiles(detail("Fix typo in README"), profiles)).toHaveLength(0);
  });

  it("lets user JSON override, add and disable profiles", async () => {
    process.env.MNLENS_RESEARCH_PROFILES_JSON = JSON.stringify([
      { id: "oracle-ucp-opentelemetry", enabled: false },
      { id: "kafka", title: "Kafka clients", triggers: ["kafkaproducer"], codeSearchQueries: ['"KafkaProducer" owner:apache'], exactMatchTerms: ["KafkaProducer"], relevanceTerms: [{ term: "kafka", weight: 5 }], curatedSources: [], promptGuidance: ["Compare producer lifecycle handling."] }
    ]);
    const profiles = await loadResearchProfiles();
    expect(profiles.map((profile) => profile.id)).not.toContain("oracle-ucp-opentelemetry");
    const kafka = matchingProfiles(detail("Use KafkaProducer in outbox"), profiles);
    expect(kafka.map((profile) => profile.id)).toEqual(["kafka"]);
    expect(profileRelevance("apache kafka client", kafka)).toBe(5);
    expect(exactMatchPattern(kafka)?.test("new KafkaProducer<>()")).toBe(true);
    expect(exactMatchPattern([])).toBeUndefined();
  });
});
