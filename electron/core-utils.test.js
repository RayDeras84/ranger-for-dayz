import { describe, expect, it } from "vitest";
import {
  inferMapFromText,
  isAllowedExternalUrl,
  normalizeFundingUrl,
  normalizeMapName,
  normalizeRepositoryUrl,
  parseVdfObject,
  pingStatusFromMs
} from "./core-utils.mjs";

describe("core Electron helpers", () => {
  it("normalizes supported GitHub repository URLs", () => {
    expect(normalizeRepositoryUrl("https://github.com/RayDeras84/ranger-for-dayz#readme")).toBe("https://github.com/RayDeras84/ranger-for-dayz");
    expect(normalizeRepositoryUrl("https://github.com/RayDeras84/ranger-for-dayz.git")).toBe("https://github.com/RayDeras84/ranger-for-dayz");
    expect(normalizeRepositoryUrl("https://example.com/RayDeras84/ranger-for-dayz")).toBe("");
  });

  it("normalizes GitHub Sponsors URLs only", () => {
    expect(normalizeFundingUrl("https://github.com/sponsors/RayDeras84/")).toBe("https://github.com/sponsors/RayDeras84");
    expect(normalizeFundingUrl({ url: "https://github.com/sponsors/RayDeras84?x=1" })).toBe("https://github.com/sponsors/RayDeras84");
    expect(normalizeFundingUrl("https://github.com/RayDeras84")).toBe("");
  });

  it("parses Steam VDF objects used for library and manifest reads", () => {
    const parsed = parseVdfObject(`
      "libraryfolders"
      {
        "0"
        {
          "path" "C:\\\\Program Files (x86)\\\\Steam"
        }
      }
    `);

    expect(parsed.libraryfolders["0"].path).toBe("C:\\\\Program Files (x86)\\\\Steam");
  });

  it("normalizes and infers known DayZ maps", () => {
    expect(normalizeMapName("enoch")).toBe("Livonia");
    expect(normalizeMapName("stuartisland")).toBe("Stuart Island");
    expect(inferMapFromText("Fresh wipe StuartIsland vanilla")).toBe("Stuart Island");
    expect(inferMapFromText("Hardcore ChernarusPlus survival")).toBe("ChernarusPlus");
  });

  it("maps ping values to UI status buckets", () => {
    expect(pingStatusFromMs(0)).toBe("unreachable");
    expect(pingStatusFromMs(42)).toBe("good");
    expect(pingStatusFromMs(118)).toBe("fair");
    expect(pingStatusFromMs(180)).toBe("poor");
    expect(pingStatusFromMs(300)).toBe("bad");
  });

  it("allows only expected external URLs", () => {
    const context = {
      repositoryUrl: "https://github.com/RayDeras84/ranger-for-dayz",
      fundingUrl: "https://github.com/sponsors/RayDeras84"
    };

    expect(isAllowedExternalUrl("steam://connect/127.0.0.1:2302", context)).toBe(true);
    expect(isAllowedExternalUrl("steam://url/CommunityFilePage/123456", context)).toBe(true);
    expect(isAllowedExternalUrl("https://www.battlemetrics.com/servers/dayz/123", context)).toBe(true);
    expect(isAllowedExternalUrl("https://dayzsalauncher.com/", context)).toBe(true);
    expect(isAllowedExternalUrl("https://dayzsalauncher.com/api/v1/launcher/servers/dayz", context)).toBe(false);
    expect(isAllowedExternalUrl("https://github.com/RayDeras84/ranger-for-dayz/releases/latest", context)).toBe(true);
    expect(isAllowedExternalUrl("https://github.com/sponsors/RayDeras84", context)).toBe(true);
    expect(isAllowedExternalUrl("https://github.com/other/ranger-for-dayz", context)).toBe(false);
    expect(isAllowedExternalUrl("https://example.com/servers/dayz", context)).toBe(false);
    expect(isAllowedExternalUrl("file:///C:/Windows/System32/calc.exe", context)).toBe(false);
  });
});
