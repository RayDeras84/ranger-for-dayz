import { DZSA_SERVER_LIST_URL, normalizeDzsaServer } from "./server-utils.mjs";

export function createServerCatalog({ request = globalThis.fetch, now = Date.now } = {}) {
  let cache = { fetchedAt: 0, servers: [] };
  let pending = null;

  return async function fetchCatalog({ maxAgeMs = 30000 } = {}) {
    if (cache.servers.length && now() - cache.fetchedAt < maxAgeMs) return cache.servers;
    if (pending) return pending;

    pending = (async () => {
      const response = await request(DZSA_SERVER_LIST_URL, {
        headers: { Accept: "application/json" },
        signal: globalThis.AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`DZSA Launcher returned ${response.status}`);
      const payload = await response.json();
      if (payload?.status !== 0 || !Array.isArray(payload.result)) {
        throw new Error("DZSA Launcher returned an invalid server list.");
      }
      const normalized = payload.result.filter((item) => item && typeof item === "object")
        .map(normalizeDzsaServer).filter((server) => server.ip && Number.isInteger(server.port) && server.port > 0 && server.port < 65536);
      const servers = [...new Map(normalized.map((server) => [server.id, server])).values()];
      cache = { fetchedAt: now(), servers };
      return servers;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

export async function refreshServerDetails(server, fetchCatalog, enrichServer) {
  if (!server?.ip) throw new Error("This server does not have an address to refresh.");
  let refreshed = server;
  let sourceWarning = "";
  try {
    const catalog = await fetchCatalog({ maxAgeMs: 0 });
    const current = catalog.find((item) => item.ip === server.ip && item.port === Number(server.port));
    if (current) refreshed = { ...server, ...current };
    else sourceWarning = "The server is no longer listed by DZSA; showing its last known details.";
  } catch (error) {
    sourceWarning = `Could not refresh server details: ${error.message}. Showing last known details.`;
  }
  return { ...await enrichServer(refreshed), sourceWarning };
}
