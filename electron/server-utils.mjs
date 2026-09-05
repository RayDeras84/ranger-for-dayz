import { inferMapFromText, normalizeMapName } from "./core-utils.mjs";

export const DZSA_SERVER_LIST_URL = "https://dayzsalauncher.com/api/v1/launcher/servers/dayz";

function compactSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
}

export function migrateServerState(state = {}) {
  if (!Array.isArray(state.recents)) return state;

  const migratedIds = new Map();
  const recents = state.recents.map((server) => {
    if (!server || typeof server !== "object") return server;
    const legacyId = String(server.legacyId || server.id || "");
    const ip = String(server.ip || "").trim();
    const port = validPort(server.port);
    if (!/^\d+$/.test(legacyId) || !ip || !port) return server;

    const id = `dzsa:${ip}:${port}`;
    migratedIds.set(legacyId, id);
    return { ...server, id, legacyId };
  });

  return {
    ...state,
    recents,
    ...(Array.isArray(state.favorites) ? {
      favorites: [...new Set(state.favorites.map((id) => migratedIds.get(String(id)) || id))]
    } : {})
  };
}

export function normalizeDzsaServer(item = {}) {
  if (!item || typeof item !== "object") item = {};
  const ip = String(item.endpoint?.ip || "").trim();
  const port = validPort(item.gamePort);
  const queryPort = validPort(item.endpoint?.port) || validPort(port + 1);
  const mods = Array.isArray(item.mods) ? item.mods : [];
  const modIds = [...new Set(mods.map((mod) => String(mod?.steamWorkshopId || "")).filter((id) => /^\d+$/.test(id)))];
  const modNames = mods.map((mod) => String(mod?.name || "").trim()).filter(Boolean);
  const explicitMap = normalizeMapName(item.map || item.mission || "");
  const inferredMap = inferMapFromText(`${item.name || ""} ${modNames.join(" ")}`);
  const official = String(item.shard || "").toLowerCase() === "public";

  return {
    id: `dzsa:${ip}:${port}`,
    name: String(item.name || "Unnamed DayZ server"),
    ip,
    port,
    queryPort,
    players: Number(item.players || 0),
    maxPlayers: Number(item.maxPlayers || 0),
    pingMs: null,
    pingStatus: "unknown",
    lastPingAt: "",
    rank: null,
    map: explicitMap !== "Unknown" ? explicitMap : inferredMap || "Unknown",
    mapSource: explicitMap !== "Unknown" ? "source" : inferredMap ? "inferred" : "unknown",
    status: "online",
    country: "",
    version: String(item.version || ""),
    password: Boolean(item.password),
    official,
    modded: modIds.length > 0,
    firstPerson: Boolean(item.firstPersonOnly),
    time: String(item.time || ""),
    details: {
      queryPort,
      shard: String(item.shard || ""),
      battlEye: Boolean(item.battlEye),
      vac: Boolean(item.vac)
    },
    modIds,
    modNames,
    source: "dzsa",
    sourceLabel: "DZSA Launcher",
    sourceUrl: "https://dayzsalauncher.com/"
  };
}

function searchText(server) {
  return [
    server.name,
    server.ip,
    server.port,
    server.map,
    server.official ? "official public" : "community private",
    ...(server.modNames || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function compareServers(a, b, sort) {
  const descending = String(sort || "-players").startsWith("-");
  const key = String(sort || "-players").replace(/^-/, "");
  let comparison = 0;

  if (key === "players" || key === "maxPlayers" || key === "rank") {
    comparison = Number(a[key] || 0) - Number(b[key] || 0);
  } else {
    comparison = String(a[key] || "").localeCompare(String(b[key] || ""));
  }

  if (comparison === 0) comparison = a.name.localeCompare(b.name);
  return descending ? -comparison : comparison;
}

export function selectDzsaServers(servers = [], options = {}) {
  const query = String(options.search || "").trim().toLowerCase();
  const compactQuery = compactSearchText(query);
  const country = String(options.country || "").trim().toLowerCase();
  const limit = Math.min(Math.max(1, Number(options.limit || 500)), 5000);

  return servers
    .filter((server) => {
      const text = searchText(server);
      if (query && !text.includes(query) && !compactSearchText(text).includes(compactQuery)) return false;
      if (country && String(server.country || "").toLowerCase() !== country) return false;
      return true;
    })
    .sort((a, b) => compareServers(a, b, options.sort || "-players"))
    .slice(0, limit);
}
