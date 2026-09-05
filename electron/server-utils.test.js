import { describe, expect, it } from "vitest";
import { DZSA_SERVER_LIST_URL, migrateServerState, normalizeDzsaServer, selectDzsaServers } from "./server-utils.mjs";

const community = normalizeDzsaServer({
  gamePort: 2302,
  endpoint: { ip: "192.0.2.10", port: 2303 },
  name: "StuartIsland Practice",
  map: "stuartisland",
  players: 24,
  maxPlayers: 60,
  password: false,
  version: "1.29",
  firstPersonOnly: true,
  shard: "private",
  mods: [{ name: "CF", steamWorkshopId: 1559212036 }]
});

const official = normalizeDzsaServer({
  gamePort: 2402,
  endpoint: { ip: "192.0.2.20", port: 2403 },
  name: "6032 | NORTH AMERICA - NY",
  map: "enoch",
  players: 12,
  maxPlayers: 60,
  shard: "public",
  mods: []
});

describe("DZSA server helpers", () => {
  it("uses the live DayZ server-list endpoint", () => {
    expect(DZSA_SERVER_LIST_URL).toBe("https://dayzsalauncher.com/api/v1/launcher/servers/dayz");
  });

  it("normalizes launcher servers into Ranger's server shape", () => {
    expect(community).toMatchObject({
      id: "dzsa:192.0.2.10:2302",
      ip: "192.0.2.10",
      port: 2302,
      queryPort: 2303,
      map: "Stuart Island",
      players: 24,
      maxPlayers: 60,
      official: false,
      modded: true,
      firstPerson: true,
      modIds: ["1559212036"],
      modNames: ["CF"],
      sourceLabel: "DZSA Launcher"
    });
    expect(official).toMatchObject({ map: "Livonia", official: true, modded: false });
  });

  it("supports compact searches, official searches, and player sorting", () => {
    expect(selectDzsaServers([official, community], { search: "stuart island" })).toEqual([community]);
    expect(selectDzsaServers([official, community], { search: "stuartisland" })).toEqual([community]);
    expect(selectDzsaServers([community, official], { search: "official" })).toEqual([official]);
    expect(selectDzsaServers([official, community], { sort: "-players" })).toEqual([community, official]);
  });

  it("keeps malformed feed records from producing a usable game endpoint", () => {
    expect(normalizeDzsaServer(null)).toMatchObject({ ip: "", port: 0 });
    for (const gamePort of [undefined, 0, -1, 65536, 2302.5, "not-a-port"]) {
      expect(normalizeDzsaServer({ endpoint: { ip: "192.0.2.10" }, gamePort }).port).toBe(0);
    }
    expect(normalizeDzsaServer({ endpoint: { ip: "192.0.2.10", port: -1 }, gamePort: "2302" }))
      .toMatchObject({ port: 2302, queryPort: 2303 });
  });

  it("ignores invalid Workshop IDs and removes duplicates", () => {
    const server = normalizeDzsaServer({ mods: [null, { steamWorkshopId: "invalid" }, { steamWorkshopId: 1559212036 }, { steamWorkshopId: "1559212036" }] });
    expect(server.modIds).toEqual(["1559212036"]);
  });
});

describe("saved server migration", () => {
  const legacyRecent = {
    id: "123456",
    ip: "192.0.2.10",
    port: 2302,
    name: "Saved community server",
    modIds: ["1559212036"],
    sourceUrl: "https://www.battlemetrics.com/servers/dayz/123456"
  };

  it("migrates known favorites using saved endpoints and preserves unresolved IDs and settings", () => {
    const saved = {
      recents: [legacyRecent],
      favorites: ["123456", "987654", "dzsa:192.0.2.10:2302"],
      playerName: "Survivor",
      preferBattlEye: false,
      launchExtraArgs: "-nosplash"
    };
    const migrated = migrateServerState(saved);
    expect(migrated).toEqual({
      ...saved,
      recents: [{ ...legacyRecent, id: "dzsa:192.0.2.10:2302", legacyId: "123456" }],
      favorites: ["dzsa:192.0.2.10:2302", "987654"]
    });
    expect(saved.recents[0]).toEqual(legacyRecent);
    expect(saved.favorites).toEqual(["123456", "987654", "dzsa:192.0.2.10:2302"]);
    expect(migrateServerState(migrated)).toEqual(migrated);
  });

  it("uses retained legacy IDs for favorites saved after a history migration", () => {
    const saved = {
      recents: [{ ...legacyRecent, id: "dzsa:192.0.2.10:2302", legacyId: "123456" }],
      favorites: [123456, "654321"]
    };
    expect(migrateServerState(saved).favorites).toEqual(["dzsa:192.0.2.10:2302", "654321"]);
  });

  it("leaves unknown IDs and incomplete endpoints intact", () => {
    const saved = {
      recents: [
        { ...legacyRecent, ip: "" },
        { ...legacyRecent, id: "654321", port: 65536 },
        { ...legacyRecent, id: "preview-1" }
      ],
      favorites: ["123456", "654321", "preview-1"]
    };
    expect(migrateServerState(saved)).toEqual(saved);
    expect(migrateServerState({ favorites: ["123456"] })).toEqual({ favorites: ["123456"] });
  });
});
