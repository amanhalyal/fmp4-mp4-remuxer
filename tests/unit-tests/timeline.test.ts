import { describe, it, expect } from "vitest";
import { normalizeTimeline } from "../../src/core/TimelineNormalizer";

describe("Timeline normalization", () => {
  it("keeps timestamps monotonic", () => {
    const input = [100, 90, 110];
    const output = normalizeTimeline(input);
    expect(output[1]).toBeGreaterThanOrEqual(output[0]);
  });
});
