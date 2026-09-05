import { DZSA_SERVER_LIST_URL, normalizeDzsaServer, selectDzsaServers } from "../electron/server-utils.mjs";

const BASE = DZSA_SERVER_LIST_URL;
let catalogPromise;

function normalizeMap(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function searchAliases(value) {
  const clean = String(value || "").trim();
  if (!clean) return [];
  const aliases = new Set([clean]);
  aliases.add(clean.replace(/([a-z])([A-Z])/g, "$1 $2"));
  aliases.add(clean.replace(/\s+/g, ""));
  aliases.add(clean.replace(/island/ig, " island").replace(/\s+/g, " ").trim());
  aliases.add(clean.replace(/island/ig, "").replace(/\s+/g, " ").trim());
  aliases.add(clean.replace(/plus$/i, ""));
  return [...aliases].filter((alias) => alias.length >= 3);
}

async function fetchCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(BASE, { headers: { Accept: "application/json" }, signal: globalThis.AbortSignal.timeout(30000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`DZSA Launcher ${response.status}`);
        const payload = await response.json();
        if (payload?.status !== 0 || !Array.isArray(payload.result)) throw new Error("DZSA Launcher returned an invalid list");
        return payload.result.map(normalizeDzsaServer);
      });
  }
  return catalogPromise;
}

async function fetchDzsaServers({ search = "", limit = 100, sort = "-players" } = {}) {
  const catalog = await fetchCatalog();
  return selectDzsaServers(catalog, { search, limit, sort });
}

function localFilter(servers, { query = "", map = "", officialOnly = false } = {}) {
  const queryText = query.trim().toLowerCase();
  const queryCompact = normalizeMap(query);
  const mapFilter = normalizeMap(map);
  return servers.filter((server) => {
    const text = [
      server.name,
      server.ip,
      server.port,
      server.map,
      server.official ? "official public" : "community private",
      ...server.modNames
    ].filter(Boolean).join(" ").toLowerCase();
    const compactText = normalizeMap(text);
    if (queryText && !text.includes(queryText) && !compactText.includes(queryCompact)) return false;
    if (mapFilter && normalizeMap(server.map) !== mapFilter && !compactText.includes(mapFilter)) return false;
    if (officialOnly && !server.official) return false;
    return true;
  });
}

async function targetedSearch(query) {
  const terms = [...new Set(searchAliases(query))];
  const batches = await Promise.all(terms.slice(0, 4).map((term) => fetchDzsaServers({ search: term, limit: 300 })));
  const byId = new Map();
  for (const server of batches.flat()) byId.set(server.id, server);
  return [...byId.values()];
}

function assertCase(name, pass, detail) {
  return { name, pass, detail };
}

const cases = [];

const stuart = await targetedSearch("stuartisland");
cases.push(assertCase(
  "Targeted search stuartisland finds DayZed.GG Stuart Island",
  stuart.some((server) => server.ip === "185.187.152.25" && server.port === 2701),
  stuart.slice(0, 10).map((server) => `${server.name} ${server.ip}:${server.port}`).join("\n")
));

cases.push(assertCase(
  "Local map filter stuartisland keeps Stuart Island matches",
  localFilter(stuart, { map: "stuartisland" }).some((server) => server.name.includes("DayZed.GG Stuart Island"))
    && localFilter(stuart, { map: "stuartisland" }).some((server) => server.name.includes("Jurassic Island Stuart Island")),
  localFilter(stuart, { map: "stuartisland" }).map((server) => `${server.map} | ${server.name}`).slice(0, 10).join("\n")
));

cases.push(assertCase(
  "Local map filter Stuart Island keeps compact stuartisland query",
  localFilter(stuart, { query: "stuartisland", map: "Stuart Island" }).some((server) => server.name.includes("Stuart Island")),
  localFilter(stuart, { query: "stuartisland", map: "Stuart Island" }).map((server) => server.name).slice(0, 10).join("\n")
));

const official = await fetchDzsaServers({ limit: 5000 });
const officialOnly = localFilter(official, { officialOnly: true });
const officialSearch = await fetchDzsaServers({ search: "official", limit: 100 });
cases.push(assertCase(
  "Official text search survives renderer filtering",
  officialSearch.some((server) => server.official) && localFilter(officialSearch, { query: "official" }).length === officialSearch.length,
  `${officialSearch.length} official search results remain visible`
));
cases.push(assertCase(
  "Official filter only keeps official servers",
  officialOnly.length > 0 && officialOnly.every((server) => server.official),
  `${officialOnly.length}/${official.length} official from sample`
));

const defaultSample = await fetchDzsaServers({ limit: 100 });
cases.push(assertCase(
  "Default sample includes full/password/empty candidates instead of hiding by default",
  defaultSample.length === 100,
  `${defaultSample.length} servers fetched; filtering defaults are intentionally off in UI`
));

const failed = cases.filter((item) => !item.pass);
console.log(JSON.stringify({
  ok: failed.length === 0,
  checkedAt: new Date().toISOString(),
  cases
}, null, 2));

if (failed.length) process.exitCode = 1;
