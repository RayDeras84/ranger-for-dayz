import { describe, expect, it } from "vitest";

describe("project setup", () => {
  it("has a working Vitest test target", () => {
    expect("Ranger for DayZ").toContain("Ranger");
  });
});
