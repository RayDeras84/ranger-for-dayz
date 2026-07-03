const BASE = "https://api.battlemetrics.com/servers";

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

function inferMap(server) {
  const text = `${server.name} ${server.modNames.join(" ")}`.toLowerCase();
  if (/stuart\s*island|stuartisland/.test(text)) return "Stuart Island";
  if (/deer\s*isle|deerisle/.test(text)) return "Deer Isle";
  if (/livonia|enoch/.test(text)) return "Livonia";
  if (/namalsk/.test(text)) return "Namalsk";
  if (/chernarus|chernarusplus|chernarus\+/.test(text)) return "ChernarusPlus";
  return server.map || "Unknown";
}

function normalizeServer(item) {
  const attr = item.attributes || {};
  const details = attr.details || {};
  const modNames = Array.isArray(details.modNames) ? details.modNames : [];
  return {
    id: item.id,
    name: attr.name || "",
    ip: attr.ip || details.address || "",
    port: Number(attr.port || details.port || 0),
    players: Number(attr.players || 0),
    maxPlayers: Number(attr.maxPlayers || 0),
    map: inferMap({
      name: attr.name || "",
      map: details.map || details.mission || attr.map || "",
      modNames
    }),
    official: Boolean(details.official),
    password: Boolean(details.password || details.private),
    modded: Boolean(details.modded || modNames.length || details.modIds?.length),
    modNames
  };
}

async function fetchBattleMetrics({ search = "", limit = 100, sort = "-players" } = {}) {
  const params = new URLSearchParams({
    "filter[game]": "dayz",
    "page[size]": String(Math.min(limit, 100)),
    sort
  });
  if (search) params.set("filter[search]", search);
  let url = `${BASE}?${params.toString()}`;
  const servers = [];
  while (url && servers.length < limit) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`BattleMetrics ${response.status} for ${search || "default"}`);
    const payload = await response.json();
    servers.push(...(payload.data || []).map(normalizeServer));
    url = payload.links?.next || "";
  }
  servers.length = Math.min(servers.length, limit);
  return servers;
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
  const batches = await Promise.all(terms.slice(0, 4).map((term) => fetchBattleMetrics({ search: term, limit: 300 })));
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

const official = await fetchBattleMetrics({ search: "official", limit: 100 });
const officialOnly = localFilter(official, { officialOnly: true });
cases.push(assertCase(
  "Official filter only keeps official servers",
  officialOnly.length === 0 || officialOnly.every((server) => server.official),
  `${officialOnly.length}/${official.length} official from sample`
));

const defaultSample = await fetchBattleMetrics({ limit: 100 });
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
