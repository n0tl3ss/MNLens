import { describe, expect, it } from "vitest";
import { hashText, prKey } from "../src/server/cache";

describe("cache helpers", () => {
  it("builds stable PR cache keys", () => {
    expect(prKey("open-telemetry", "opentelemetry-java", 123)).toBe("open-telemetry__opentelemetry-java__123");
  });

  it("hashes text deterministically", () => {
    expect(hashText("same diff")).toBe(hashText("same diff"));
    expect(hashText("same diff")).not.toBe(hashText("other diff"));
  });
});
