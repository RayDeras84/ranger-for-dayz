import packageMetadata from "../package.json";

const mockServers = [
  {
    id: "preview-1",
    name: "The Walking Zed | Chernarus | 1PP | Traders",
    ip: "192.0.2.15",
    port: 2302,
    queryPort: 2303,
    players: 74,
    maxPlayers: 90,
    pingMs: 42,
    pingStatus: "good",
    lastPingAt: new Date().toISOString(),
    rank: 42,
    map: "ChernarusPlus",
    status: "online",
    country: "US",
    version: "1.28",
    password: false,
    official: false,
    modded: true,
    firstPerson: true,
    time: "15:42",
    modIds: ["1559212036", "1564026768", "1797720064"],
    sourceUrl: "https://www.battlemetrics.com/servers/dayz"
  },
  {
    id: "preview-2",
    name: "Vanilla Survival West | No Mods | Active Admins",
    ip: "198.51.100.9",
    port: 2302,
    queryPort: 2303,
    players: 31,
    maxPlayers: 60,
    pingMs: 118,
    pingStatus: "fair",
    lastPingAt: new Date().toISOString(),
    rank: 318,
    map: "Livonia",
    status: "online",
    country: "US",
    version: "1.28",
    password: false,
    official: false,
    modded: false,
    firstPerson: false,
    time: "09:18",
    modIds: [],
    sourceUrl: "https://www.battlemetrics.com/servers/dayz"
  }
];

function previewPingStatus(ms) {
  if (ms <= 70) return "good";
  if (ms <= 130) return "fair";
  if (ms <= 220) return "poor";
  return "bad";
}

const fallbackApi = {
  getAppInfo: async () => ({
    name: "Ranger for DayZ",
    productName: "Ranger for DayZ",
    version: packageMetadata.version,
    description: "An unofficial DayZ server browser, mod helper, and launcher.",
    license: "MIT",
    isPackaged: false,
    platform: "browser",
    arch: "",
    versions: {
      electron: "",
      chrome: "",
      node: ""
    },
    repositoryUrl: "",
    releasesUrl: "",
    latestReleaseUrl: "",
    licenseUrl: "",
    noticesUrl: "",
    fundingUrl: "https://github.com/sponsors/RayDeras84",
    update: {
      status: "disabled",
      message: "Automatic updates are available in the desktop app.",
      checking: false,
      progress: 0
    }
  }),
  openExternal: async (url) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    return { ok: Boolean(url), url };
  },
  checkForUpdates: async () => ({
    status: "disabled",
    message: "Automatic updates are available in packaged installer builds.",
    checking: false,
    progress: 0
  }),
  installUpdate: async () => ({
    status: "disabled",
    message: "No downloaded update is ready to install.",
    checking: false
  }),
  onUpdateStatus: () => () => {},
  getState: async () => ({
    favorites: [],
    recents: [],
    playerName: "Survivor",
    launchExtraArgs: "",
    preferBattlEye: true
  }),
  saveState: async (patch) => patch,
  detectPaths: async () => ({
    steamPath: "",
    dayzPath: "",
    steamExe: "",
    dayzExe: "",
    dayzRawExe: "",
    workshopPath: "",
    dzsaPath: ""
  }),
  scanMods: async () => ({ paths: {}, mods: [] }),
  deleteMod: async () => ({ ok: false, message: "Mod deletion is available in the desktop app." }),
  deleteMods: async () => ({ ok: false, deleted: [], failed: [{ message: "Mod deletion is available in the desktop app." }] }),
  listServers: async () => mockServers,
  discoverServers: async () => ({ ok: true, totalFetched: mockServers.length, limit: mockServers.length }),
  refreshServer: async (server) => {
    const pingMs = Math.max(18, Math.round(Number(server.pingMs || 80) + (Math.random() * 18 - 9)));
    return {
      ...server,
      players: Math.max(0, Math.min(server.maxPlayers || 120, Number(server.players || 0) + 1)),
      pingMs,
      pingStatus: previewPingStatus(pingMs),
      lastPingAt: new Date().toISOString()
    };
  },
  onServerDiscovery: (callback) => {
    setTimeout(() => callback({ phase: "page", batch: mockServers, totalFetched: mockServers.length, limit: mockServers.length }), 50);
    setTimeout(() => callback({ phase: "complete", batch: [], totalFetched: mockServers.length, limit: mockServers.length }), 100);
    return () => {};
  },
  openSteam: async (url) => ({ ok: true, url }),
  probeSteam: async () => ({ ok: false, message: "Steamworks is available in the desktop app." }),
  syncWorkshop: async ({ itemIds = [] }) => ({
    ok: false,
    items: itemIds.map((id) => ({ id, progress: 0 })),
    failed: [{ id: "preview", message: "Workshop sync is available in the desktop app." }]
  }),
  stopWorkshopSync: async () => ({ ok: true, stopped: true }),
  onSyncProgress: () => () => {},
  launch: async () => ({ ok: false, message: "Launch is available in the desktop app." })
};

export const launcherApi = globalThis.window?.dayz ?? fallbackApi;
