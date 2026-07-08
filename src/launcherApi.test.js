import { describe, expect, it } from "vitest";
import packageMetadata from "../package.json";
import { launcherApi } from "./launcherApi";

describe("launcher API browser fallback", () => {
  it("reports package metadata in non-Electron previews", async () => {
    const info = await launcherApi.getAppInfo();

    expect(info.productName).toBe("Ranger for DayZ");
    expect(info.version).toBe(packageMetadata.version);
    expect(info.isPackaged).toBe(false);
    expect(info.update.status).toBe("disabled");
  });

  it("provides representative preview servers", async () => {
    const servers = await launcherApi.listServers();

    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({
      name: expect.stringContaining("Chernarus"),
      modded: true,
      firstPerson: true
    });
  });
});
