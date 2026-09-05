import { describe, expect, it, vi } from "vitest";
import { createServerCatalog, refreshServerDetails } from "./server-catalog.mjs";

const record = { endpoint: { ip: "192.0.2.10", port: 2303 }, gamePort: 2302, name: "Test DayZ", players: 12, maxPlayers: 60, mods: [] };
const response = (result = [record]) => ({ ok: true, json: async () => ({ status: 0, result }) });

describe("server catalog", () => {
  it("shares concurrent downloads, caches results, and supports a forced refresh", async () => {
    const request = vi.fn(async () => response());
    const catalog = createServerCatalog({ request });
    const [first, second] = await Promise.all([catalog(), catalog()]);
    expect(first).toBe(second);
    expect(await catalog()).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
    await catalog({ maxAgeMs: 0 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("expires the cache and deduplicates valid endpoints", async () => {
    let time = 100;
    const request = vi.fn(async () => response([record, record, null, { endpoint: { ip: "" } }, { ...record, gamePort: 70000 }]));
    const catalog = createServerCatalog({ request, now: () => time });
    expect(await catalog()).toHaveLength(1);
    time += 30001;
    await catalog();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("recovers on a later request after HTTP, malformed payload, and network failures", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 1, result: [] }) })
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValue(response());
    const catalog = createServerCatalog({ request });
    await expect(catalog()).rejects.toThrow("503");
    await expect(catalog()).rejects.toThrow("invalid server list");
    await expect(catalog()).rejects.toThrow("network unavailable");
    expect(await catalog()).toHaveLength(1);
  });
});

describe("individual server refresh", () => {
  const old = { id: "123", ip: record.endpoint.ip, port: 2302, players: 1, modIds: ["old"] };

  it("refreshes feed details by address before querying ping", async () => {
    const current = { ...old, id: "dzsa:192.0.2.10:2302", players: 50, modIds: ["new"] };
    const catalog = vi.fn(async () => [current]);
    const enrich = vi.fn(async (server) => ({ ...server, pingMs: 42 }));
    expect(await refreshServerDetails(old, catalog, enrich)).toMatchObject({ ...current, pingMs: 42, sourceWarning: "" });
    expect(catalog).toHaveBeenCalledWith({ maxAgeMs: 0 });
    expect(enrich).toHaveBeenCalledWith(current);
  });

  it("keeps saved details usable and reports a warning when the feed is unavailable", async () => {
    const result = await refreshServerDetails(old, async () => { throw new Error("503"); }, async (server) => ({ ...server, pingMs: 42 }));
    expect(result).toMatchObject({ ...old, pingMs: 42 });
    expect(result.sourceWarning).toContain("503");
  });

  it("keeps a removed server usable and rejects missing addresses", async () => {
    const result = await refreshServerDetails(old, async () => [], async (server) => server);
    expect(result).toMatchObject(old);
    expect(result.sourceWarning).toContain("no longer listed");
    await expect(refreshServerDetails({}, async () => [], async (server) => server)).rejects.toThrow("address");
  });
});
