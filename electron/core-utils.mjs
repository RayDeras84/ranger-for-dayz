export function normalizeRepositoryUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutReadme = raw.replace(/#readme$/i, "");
  const githubMatch = withoutReadme.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:\/)?$/i);
  if (!githubMatch) return "";
  return `https://github.com/${githubMatch[1]}/${githubMatch[2]}`;
}

export function normalizeFundingUrl(value) {
  const candidate = typeof value === "string" ? value : value?.url;
  const raw = String(candidate || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return "";
    if (!/^\/sponsors\/[A-Za-z0-9-]+\/?$/i.test(parsed.pathname)) return "";
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function parseVdfObject(text) {
  const tokens = [...String(text || "").matchAll(/"([^"]*)"|(\{)|(\})/g)].map((match) => match[1] ?? match[2] ?? match[3]);
  let index = 0;

  function parseIntoObject() {
    const result = {};
    while (index < tokens.length) {
      const token = tokens[index++];
      if (token === "}") break;
      if (token === "{") continue;
      const next = tokens[index++];
      if (next === "{") {
        result[token] = parseIntoObject();
      } else {
        result[token] = next ?? "";
      }
    }
    return result;
  }

  const rootKey = tokens[index++];
  if (!rootKey) return {};
  if (tokens[index] === "{") index++;
  return { [rootKey]: parseIntoObject() };
}

export function normalizeMapName(value) {
  if (!value || value === "Unknown") return "Unknown";
  const clean = String(value).trim();
  const known = {
    chernarusplus: "ChernarusPlus",
    enoch: "Livonia",
    namalsk: "Namalsk",
    deerisle: "Deer Isle",
    alteria: "Alteria",
    banov: "Banov",
    esseker: "Esseker",
    rostow: "Rostow",
    valning: "Valning",
    takistanplus: "TakistanPlus",
    iztek: "Iztek",
    swansisland: "Swans Island",
    stuartisland: "Stuart Island",
    bitterroot: "Bitterroot"
  };
  return known[clean.toLowerCase()] || clean;
}

export function inferMapFromText(text) {
  const lower = String(text || "").toLowerCase();
  const highConfidencePatterns = [
    ["Stuart Island", /\bstuart\s*island|\bstuartisland/]
  ];
  const highConfidence = highConfidencePatterns.find(([, pattern]) => pattern.test(lower));
  if (highConfidence) return highConfidence[0];

  const patterns = [
    ["ChernarusPlus", /\bchernarus|\bchernarusplus|\bchernarus\+/],
    ["Livonia", /\blivonia|\benoch\b/],
    ["Namalsk", /\bnamalsk/],
    ["Deer Isle", /\bdeer\s*isle|\bdeerisle/],
    ["Sakhal", /\bsakhal/],
    ["Banov", /\bbanov/],
    ["Esseker", /\besseker/],
    ["Alteria", /\balteria/],
    ["Bitterroot", /\bbitterroot/],
    ["TakistanPlus", /\btakistan/],
    ["Rostow", /\brostow/],
    ["Lux", /\blux\b/],
    ["ExclusionZone", /\bexclusion\s*zone|\bexclusionzone/]
  ];
  return patterns.find(([, pattern]) => pattern.test(lower))?.[0] || "";
}

export function pingStatusFromMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "unreachable";
  if (ms <= 70) return "good";
  if (ms <= 130) return "fair";
  if (ms <= 220) return "poor";
  return "bad";
}

export function isAllowedExternalUrl(value, { repositoryUrl = "", fundingUrl = "" } = {}) {
  const url = String(value || "").trim();
  if (/^steam:\/\/open\/main$/i.test(url)) return true;
  if (/^steam:\/\/connect\/[^/\s:]+:\d{1,5}$/i.test(url)) return true;
  if (/^steam:\/\/url\/CommunityFilePage\/\d+$/i.test(url)) return true;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname === "www.battlemetrics.com") return parsed.pathname.startsWith("/servers/dayz");
    if (parsed.hostname !== "github.com") return false;

    const normalizedFunding = normalizeFundingUrl(url);
    if (normalizedFunding && normalizedFunding === normalizeFundingUrl(fundingUrl)) return true;

    const normalizedRepo = normalizeRepositoryUrl(repositoryUrl);
    if (!normalizedRepo) return false;
    const repoPath = new URL(normalizedRepo).pathname.replace(/\/$/, "").toLowerCase();
    const targetPath = parsed.pathname.replace(/\/$/, "").toLowerCase();
    return targetPath === repoPath || targetPath.startsWith(`${repoPath}/`);
  } catch {
    return false;
  }
}
