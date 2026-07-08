import { describe, expect, it } from "vitest";
import { validateReleaseContext } from "./validate-release-version.mjs";

describe("release context validation", () => {
  it("accepts the owner releasing the matching version tag", () => {
    expect(validateReleaseContext({
      version: "0.0.5",
      ref: "refs/tags/v0.0.5",
      refName: "v0.0.5",
      actor: "RayDeras84"
    })).toEqual({ tag: "v0.0.5", version: "0.0.5", actor: "RayDeras84" });
  });

  it("rejects manual runs from branches", () => {
    expect(() => validateReleaseContext({
      version: "0.0.5",
      ref: "refs/heads/main",
      refName: "main",
      actor: "RayDeras84"
    })).toThrow(/version tag/);
  });

  it("rejects tag and package version mismatches", () => {
    expect(() => validateReleaseContext({
      version: "0.0.5",
      ref: "refs/tags/v0.0.4",
      refName: "v0.0.4",
      actor: "RayDeras84"
    })).toThrow(/does not match/);
  });

  it("rejects release attempts from other actors", () => {
    expect(() => validateReleaseContext({
      version: "0.0.5",
      ref: "refs/tags/v0.0.5",
      refName: "v0.0.5",
      actor: "someone-else"
    })).toThrow(/Only RayDeras84/);
  });
});
