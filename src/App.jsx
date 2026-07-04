import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  Download,
  ExternalLink,
  Filter,
  Heart,
  History,
  Info,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Star,
  Trash2,
  X
} from "lucide-react";
import { launcherApi } from "./launcherApi";
import "./styles.css";

const emptyPaths = {
  steamPath: "",
  dayzPath: "",
  steamExe: "",
  dayzExe: "",
  dayzRawExe: "",
  workshopPath: "",
  dzsaPath: ""
};

const defaultUpdateStatus = {
  status: "idle",
  message: "Updates have not been checked yet.",
  checking: false,
  progress: 0,
  updateInfo: null,
  error: ""
};

const defaultAppInfo = {
  productName: "Ranger for DayZ",
  version: "0.0.2",
  description: "An unofficial DayZ server browser, mod helper, and launcher.",
  license: "MIT",
  isPackaged: false,
  platform: "",
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
  update: defaultUpdateStatus
};

const serverTableColumns = [
  { key: "name", label: "Server", min: 280 },
  { key: "players", label: "Players", min: 86 },
  { key: "ping", label: "Ping", min: 78 },
  { key: "map", label: "Map", min: 100 },
  { key: "rank", label: "Rank", min: 64 }
];

const defaultServerColumnWidths = [420, 112, 86, 150, 70];

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function percent(server) {
  if (!server.maxPlayers) return 0;
  return Math.min(100, Math.round((server.players / server.maxPlayers) * 100));
}

function pingLabel(server) {
  const ms = Number(server?.pingMs);
  if (Number.isFinite(ms) && ms > 0) return `${Math.round(ms)} ms`;
  return server?.lastPingAt ? "No reply" : "Pending";
}

function pingTitle(server) {
  const label = pingLabel(server);
  if (!server?.lastPingAt) return "Ping has not been measured yet.";
  const checked = new Date(server.lastPingAt);
  const checkedText = Number.isNaN(checked.getTime()) ? "" : ` Checked ${checked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  return `${label}.${checkedText}`;
}

function pingTone(server) {
  const status = server?.pingStatus || "unknown";
  if (["good", "fair", "poor", "bad", "unreachable"].includes(status)) return status;
  return server?.lastPingAt ? "unreachable" : "unknown";
}

function modStatus(server, mods) {
  if (!server?.modIds?.length) return { total: 0, installed: 0, missing: [] };
  const installedIds = new Set(mods.map((mod) => String(mod.id)));
  const missing = server.modIds.filter((id) => !installedIds.has(String(id)));
  return { total: server.modIds.length, installed: server.modIds.length - missing.length, missing };
}

function applySyncStatus(status, syncProgress) {
  const blocked = new Set((syncProgress?.items || [])
    .filter((item) => item.failed && item.unrecoverable)
    .map((item) => String(item.id)));
  if (!blocked.size) return { ...status, playableInstalled: status.installed, playableTotal: status.total, blocked: [] };
  const blockedMissing = status.missing.filter((id) => blocked.has(String(id)));
  return {
    ...status,
    playableInstalled: status.installed,
    playableTotal: Math.max(0, status.total - blockedMissing.length),
    missing: status.missing.filter((id) => !blocked.has(String(id))),
    blocked: blockedMissing
  };
}

function mergeServers(existing, incoming) {
  if (!incoming?.length) return existing;
  const byId = new Map(existing.map((server) => [server.id, server]));
  for (const server of incoming) {
    byId.set(server.id, { ...(byId.get(server.id) || {}), ...server });
  }
  return [...byId.values()];
}

function compareValues(a, b, direction = "asc") {
  const modifier = direction === "asc" ? 1 : -1;
  if (typeof a === "number" || typeof b === "number") {
    return ((Number(a) || 0) - (Number(b) || 0)) * modifier;
  }
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" }) * modifier;
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

function mapKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function serverSearchText(server) {
  return [
    server.name,
    server.ip,
    server.port,
    server.map,
    server.country,
    ...(server.modNames || [])
  ].filter(Boolean).join(" ");
}

function discoveryLabel(discovery, count) {
  if (discovery.phase === "idle" || discovery.phase === "complete") return `${count} found`;
  return `${count}/${discovery.limit || 5000} found`;
}

function pathLabel(value) {
  return value || "Not found";
}

function bytesLabel(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
}

function isWorkshopItemReady(item) {
  return Boolean(item?.installed && !item.needsUpdate && !item.downloading && !item.downloadPending);
}

function isWorkshopItemDone(item) {
  return isWorkshopItemReady(item) || Boolean(item?.failed || item?.stopped);
}

function syncItemLabel(item) {
  if (!item) return "Pending";
  if (item.unrecoverable) return "Unavailable";
  if (item.stopped) return "Stopped";
  if (item.failed) return "Issue";
  if (isWorkshopItemReady(item)) return "Ready";
  if (item.downloading) return "Downloading";
  if (item.downloadPending) return "Queued";
  if (item.needsUpdate) return "Needs sync";
  if (item.subscribed) return "Subscribed";
  return "Pending";
}

function syncItemDetail(item) {
  if (!item) return "Waiting for Steam";
  if (item.unrecoverable) return item.issue || "Unavailable";
  if (item.stopped) return item.issue || "Stopped";
  if (item.failed) return item.issue ? `Issue: ${item.issue}` : "Issue";
  const progress = Number(item.progress) || 0;
  const current = bytesLabel(item.currentBytes);
  const total = bytesLabel(item.totalBytes);
  const size = current && total ? `${current} / ${total}` : total || "";
  if (isWorkshopItemReady(item)) return "Installed";
  return `${syncItemLabel(item)} ${progress}%${size ? ` (${size})` : ""}`;
}

function shortIssue(value) {
  const text = String(value || "");
  if (text.includes("unavailable or not public")) {
    return "Unavailable or not public";
  }
  if (text.includes("did not start")) {
    return "Steam did not start download";
  }
  return text || "Steam reported an issue";
}

function modDisplayName(mod) {
  const name = String(mod?.name || "").trim();
  const id = String(mod?.id || "").trim();
  return name || (id ? `Workshop ${id}` : "Unknown Workshop mod");
}

function isSyncableMod(mod) {
  return /^\d+$/.test(String(mod?.id || ""));
}

function modActionPayload(mod) {
  return {
    id: String(mod?.id || ""),
    name: modDisplayName(mod),
    path: mod?.path || "",
    source: mod?.source || "",
    installed: Boolean(mod?.installed)
  };
}

function App() {
  const [state, setState] = useState({
    favorites: [],
    recents: [],
    playerName: "Survivor",
    launchExtraArgs: "",
    preferBattlEye: true
  });
  const [paths, setPaths] = useState(emptyPaths);
  const [mods, setMods] = useState([]);
  const [servers, setServers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "players", direction: "desc" });
  const [discovery, setDiscovery] = useState({ phase: "idle", totalFetched: 0, limit: 0 });
  const [filters, setFilters] = useState({
    hideFull: false,
    hideEmpty: false,
    noPassword: false,
    moddedOnly: false,
    officialOnly: false,
    favoritesOnly: false,
    perspective: "all",
    map: ""
  });
  const [activeView, setActiveView] = useState("servers");
  const [loading, setLoading] = useState({ servers: false, mods: false, launch: false });
  const [syncProgress, setSyncProgress] = useState({ phase: "idle", items: [], failed: [] });
  const [stoppingSync, setStoppingSync] = useState(false);
  const [steamInfo, setSteamInfo] = useState(null);
  const [appInfo, setAppInfo] = useState(defaultAppInfo);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const [serverContextMenu, setServerContextMenu] = useState(null);
  const [modContextMenu, setModContextMenu] = useState(null);
  const [refreshingServerId, setRefreshingServerId] = useState("");
  const mapFilterRef = useRef(null);
  const tableHeadRef = useRef(null);
  const resizeCleanupRef = useRef(null);
  const [serverColumnWidths, setServerColumnWidths] = useState(defaultServerColumnWidths);
  const [serverColumnsFixed, setServerColumnsFixed] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      const [saved, detected, scan] = await Promise.all([
        launcherApi.getState(),
        launcherApi.detectPaths(),
        launcherApi.scanMods()
      ]);
      if (!mounted) return;
      setState((current) => ({ ...current, ...saved }));
      setPaths({ ...emptyPaths, ...detected });
      setMods(scan.mods || []);
      refreshServers({ silent: true });
    }
    boot().catch((err) => setError(err.message));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    launcherApi.getAppInfo()
      .then((info) => {
        if (mounted) setAppInfo({ ...defaultAppInfo, ...info, update: { ...defaultUpdateStatus, ...info.update } });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => launcherApi.onSyncProgress((payload) => {
    setSyncProgress(payload);
  }), []);

  useEffect(() => launcherApi.onUpdateStatus((payload) => {
    setAppInfo((current) => ({
      ...current,
      update: { ...defaultUpdateStatus, ...payload }
    }));
  }), []);

  useEffect(() => launcherApi.onServerDiscovery((payload) => {
    if (payload.phase === "started") {
      setServers([]);
      setSelectedId("");
      setDiscovery(payload);
      setNotice(`Discovering DayZ servers... 0/${payload.limit}`);
      return;
    }

    if (payload.batch?.length) {
      setServers((current) => mergeServers(current, payload.batch));
      setSelectedId((current) => current || payload.batch[0]?.id || "");
    }

    setDiscovery((current) => ({ ...current, ...payload }));

    if (payload.phase === "page") {
      setNotice(`Found ${payload.totalFetched}/${payload.limit} servers. Mapping details in the background...`);
    } else if (payload.phase === "mapped") {
      setNotice(`Mapped ${payload.totalFetched}/${payload.limit} discovered servers so far.`);
    } else if (payload.phase === "complete") {
      setLoading((current) => ({ ...current, servers: false }));
      setNotice(`Discovery complete. Source returned ${payload.totalFetched} servers; targeted search can still add matches.`);
    } else if (payload.phase === "warning") {
      setNotice(payload.message || "Discovery hit a source warning; showing the servers found so far.");
    } else if (payload.phase === "error") {
      setLoading((current) => ({ ...current, servers: false }));
      setError(`Could not load servers: ${payload.message}`);
    }
  }), []);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!mapFilterRef.current?.contains(event.target)) setMapMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => () => stopColumnResize(), []);

  useEffect(() => {
    if (!serverContextMenu) return undefined;

    function closeMenu() {
      setServerContextMenu(null);
    }

    function handlePointerDown(event) {
      if (event.target instanceof Element && event.target.closest(".serverContextMenu")) return;
      closeMenu();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [serverContextMenu]);

  useEffect(() => {
    if (!modContextMenu) return undefined;

    function closeMenu() {
      setModContextMenu(null);
    }

    function handlePointerDown(event) {
      if (event.target instanceof Element && event.target.closest(".modContextMenu")) return;
      closeMenu();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") closeMenu();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [modContextMenu]);

  useEffect(() => {
    const terms = [
      ...searchAliases(query),
      ...searchAliases(filters.map)
    ].filter(Boolean);
    const uniqueTerms = [...new Set(terms)];
    if (!uniqueTerms.length || uniqueTerms.every((term) => term.length < 3)) return undefined;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const results = await Promise.all(
          uniqueTerms.slice(0, 4).map((term) => launcherApi.listServers({ search: term, limit: 300, pageSize: 100, sort: "-players" }))
        );
        if (cancelled) return;
        const incoming = results.flat().filter(Boolean);
        if (incoming.length) {
          setServers((current) => mergeServers(current, incoming));
        }
      } catch {
        // Targeted enrichment is best-effort; the background discovery remains the main source.
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [filters.map, query]);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedId) || servers[0],
    [selectedId, servers]
  );

  const contextServer = useMemo(
    () => servers.find((server) => server.id === serverContextMenu?.serverId),
    [serverContextMenu, servers]
  );

  const filteredServers = useMemo(() => {
    const favoriteSet = new Set(state.favorites || []);
    const filtered = servers.filter((server) => {
      const haystack = serverSearchText(server).toLowerCase();
      const compactHaystack = mapKey(haystack);
      const queryText = query.trim().toLowerCase();
      const queryCompact = mapKey(query);
      if (queryText && !haystack.includes(queryText) && !compactHaystack.includes(queryCompact)) return false;
      if (filters.map) {
        const mapFilter = mapKey(filters.map);
        const serverMap = mapKey(server.map);
        if (serverMap !== mapFilter) return false;
      }
      if (filters.hideFull && server.maxPlayers && server.players >= server.maxPlayers) return false;
      if (filters.hideEmpty && server.players === 0) return false;
      if (filters.noPassword && server.password) return false;
      if (filters.perspective === "firstPerson" && !server.firstPerson) return false;
      if (filters.perspective === "thirdPerson" && server.firstPerson) return false;
      if (filters.moddedOnly && !server.modded && !server.modIds.length) return false;
      if (filters.officialOnly && !server.official) return false;
      if (filters.favoritesOnly && !favoriteSet.has(server.id)) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sort.key === "name") return compareValues(a.name, b.name, sort.direction);
      if (sort.key === "players") return compareValues(a.players, b.players, sort.direction);
      if (sort.key === "ping") {
        const pingA = Number.isFinite(Number(a.pingMs)) && Number(a.pingMs) > 0 ? Number(a.pingMs) : Number.MAX_SAFE_INTEGER;
        const pingB = Number.isFinite(Number(b.pingMs)) && Number(b.pingMs) > 0 ? Number(b.pingMs) : Number.MAX_SAFE_INTEGER;
        return compareValues(pingA, pingB, sort.direction);
      }
      if (sort.key === "map") return compareValues(a.map, b.map, sort.direction);
      if (sort.key === "rank") {
        return compareValues(a.rank ?? Number.MAX_SAFE_INTEGER, b.rank ?? Number.MAX_SAFE_INTEGER, sort.direction);
      }
      return 0;
    });
  }, [filters, query, servers, sort, state.favorites]);

  const mapOptions = useMemo(() => {
    const byKey = new Map();
    for (const map of servers.map((server) => server.map).filter(Boolean)) {
      const key = mapKey(map);
      const current = byKey.get(key);
      if (!current || map.includes(" ")) byKey.set(key, map);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [servers]);

  const visibleMapOptions = useMemo(() => {
    const needle = mapKey(filters.map);
    if (!needle) return mapOptions;
    return mapOptions.filter((map) => mapKey(map).includes(needle));
  }, [filters.map, mapOptions]);

  const serverTableStyle = useMemo(() => {
    const [nameWidth, ...fixedWidths] = serverColumnWidths;
    const columnGapTotal = (serverTableColumns.length - 1) * 12;
    const rowPaddingTotal = 24;
    const minWidth = serverColumnWidths.reduce((sum, width) => sum + width, 0) + columnGapTotal + rowPaddingTotal;
    return {
      "--server-table-columns": serverColumnsFixed
        ? serverColumnWidths.map((width) => `${width}px`).join(" ")
        : `minmax(${nameWidth}px, 1fr) ${fixedWidths.map((width) => `${width}px`).join(" ")}`,
      "--server-table-min-width": `${minWidth}px`
    };
  }, [serverColumnWidths, serverColumnsFixed]);

  const selectedModStatus = applySyncStatus(modStatus(selectedServer, mods), syncProgress);

  async function refreshServers({ silent = false } = {}) {
    setLoading((current) => ({ ...current, servers: true }));
    if (!silent) setNotice("Starting background discovery...");
    setError("");
    try {
      await launcherApi.discoverServers({ search: query, limit: 5000, pageSize: 100 });
    } catch (err) {
      setError(`Could not load servers: ${err.message}`);
      setLoading((current) => ({ ...current, servers: false }));
    }
  }

  function openServerContextMenu(event, server) {
    event.preventDefault();
    setSelectedId(server.id);

    const menuWidth = 150;
    const menuHeight = 82;
    setServerContextMenu({
      serverId: server.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    });
  }

  function openModContextMenu(event, mod, scope = "server") {
    event.preventDefault();
    event.stopPropagation();
    setServerContextMenu(null);

    const menuWidth = 170;
    const menuHeight = 82;
    setModContextMenu({
      mod: modActionPayload(mod),
      scope,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    });
  }

  async function refreshSingleServer(server) {
    if (!server) return;
    setServerContextMenu(null);
    setRefreshingServerId(server.id);
    setError("");
    try {
      const refreshed = await launcherApi.refreshServer(server);
      setServers((current) => mergeServers(current, [refreshed]));
      setSelectedId(refreshed.id);
      setNotice(`Refreshed ${refreshed.name}: ${refreshed.players}/${refreshed.maxPlayers || "?"} players, ${pingLabel(refreshed)} ping.`);
    } catch (err) {
      setError(`Could not refresh ${server.name}: ${err.message}`);
    } finally {
      setRefreshingServerId("");
    }
  }

  function stopColumnResize() {
    if (!resizeCleanupRef.current) return;
    resizeCleanupRef.current();
    resizeCleanupRef.current = null;
    document.body.classList.remove("resizingColumns");
  }

  function getVisibleColumnWidths() {
    const cells = [...(tableHeadRef.current?.querySelectorAll(".tableHeadCell") || [])];
    if (cells.length !== serverTableColumns.length) return null;
    return cells.map((cell, index) => {
      const measured = Math.round(cell.getBoundingClientRect().width);
      return Math.max(serverTableColumns[index]?.min || 64, measured);
    });
  }

  function startColumnResize(index, event) {
    event.preventDefault();
    event.stopPropagation();
    stopColumnResize();

    const startX = event.clientX;
    const startWidths = getVisibleColumnWidths() || [...serverColumnWidths];
    setServerColumnWidths(startWidths);
    setServerColumnsFixed(true);
    document.body.classList.add("resizingColumns");

    function handlePointerMove(moveEvent) {
      const nextWidths = [...startWidths];
      const minWidth = serverTableColumns[index]?.min || 64;
      nextWidths[index] = Math.max(minWidth, Math.round(startWidths[index] + moveEvent.clientX - startX));
      setServerColumnWidths(nextWidths);
    }

    function handlePointerUp() {
      stopColumnResize();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    resizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }

  async function playServerFromMenu(server) {
    if (!server) return;
    setServerContextMenu(null);
    await launchServer(server);
  }

  function changeSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  function sortIndicator(key) {
    if (sort.key !== key) return "";
    return sort.direction === "asc" ? " ↑" : " ↓";
  }

  async function scanModsIntoState() {
    const scan = await launcherApi.scanMods();
    setPaths({ ...emptyPaths, ...scan.paths });
    setMods(scan.mods || []);
    return scan;
  }

  async function refreshMods() {
    setLoading((current) => ({ ...current, mods: true }));
    setNotice("Scanning local DayZ and Workshop mods...");
    try {
      const scan = await scanModsIntoState();
      setNotice(`Found ${scan.mods?.length || 0} local mods.`);
    } catch (err) {
      setError(`Could not scan mods: ${err.message}`);
    } finally {
      setLoading((current) => ({ ...current, mods: false }));
    }
  }

  async function updateState(patch) {
    const next = { ...state, ...patch };
    setState(next);
    await launcherApi.saveState(patch);
  }

  async function toggleFavorite(server) {
    const favorites = new Set(state.favorites || []);
    if (favorites.has(server.id)) favorites.delete(server.id);
    else favorites.add(server.id);
    await updateState({ favorites: [...favorites] });
  }

  async function openMissingMods() {
    if (!selectedModStatus.missing.length) return;
    await Promise.all(
      selectedModStatus.missing.slice(0, 12).map((id) =>
        launcherApi.openSteam(`steam://url/CommunityFilePage/${id}`)
      )
    );
    setNotice(
      selectedModStatus.missing.length > 12
        ? "Opened the first 12 missing Workshop pages. Steam may throttle large batches."
        : "Opened missing Workshop pages in Steam."
    );
  }

  async function syncWorkshopIds(itemIds = [], label = "Workshop mods") {
    const ids = [...new Set(itemIds.map(String).filter((id) => /^\d+$/.test(id)))];
    if (!ids.length) {
      setNotice("No syncable Workshop IDs were found.");
      return;
    }

    const single = ids.length === 1;
    setLoading((current) => ({ ...current, mods: true }));
    setError("");
    setNotice(single ? `Syncing ${label} through Steam...` : `Syncing ${ids.length} ${label} through Steam...`);
    setSyncProgress({ phase: "starting", items: ids.map((id) => ({ id, progress: 0, downloadPending: true })), failed: [] });
    try {
      const result = await launcherApi.syncWorkshop({ itemIds: ids, highPriority: true, syncPollMs: 2000 });
      await scanModsIntoState();

      if (result.ok) {
        setNotice(single ? `Steam Workshop sync complete for ${label}.` : "Steam Workshop sync complete. Mods are installed and ready for launch.");
      } else if (result.stopped) {
        setError("");
        setNotice("Steam Workshop sync stopped.");
      } else {
        const failures = result.failed || [];
        const hasUnavailableItems = failures.some((item) => item.unrecoverable);
        const message = failures.length
          ? failures.slice(0, 3).map((item) => `${item.id}: ${item.message}`).join("; ")
          : "Steam Workshop sync did not finish.";
        setError(hasUnavailableItems ? "" : message);
        setNotice(hasUnavailableItems
          ? "Some server-listed Workshop items are unavailable. The affected rows are marked below."
          : "Steam sync needs attention. The affected mod rows now show what Steam reported.");
      }
    } catch (err) {
      setError(`Steam Workshop sync failed: ${err.message}`);
      setNotice("Steam sync failed. Opening Workshop pages is still available as a fallback.");
    } finally {
      setLoading((current) => ({ ...current, mods: false }));
      setStoppingSync(false);
    }
  }

  async function syncMissingMods() {
    if (!selectedModStatus.missing.length) return;
    await syncWorkshopIds(selectedModStatus.missing, "missing Workshop mods");
  }

  async function syncMod(mod) {
    setModContextMenu(null);
    if (!isSyncableMod(mod)) {
      setNotice("This mod does not have a syncable Workshop ID.");
      return;
    }
    await syncWorkshopIds([mod.id], modDisplayName(mod));
  }

  async function syncAllMods(sourceMods = mods) {
    const ids = sourceMods.filter(isSyncableMod).map((mod) => mod.id);
    await syncWorkshopIds(ids, "Workshop mods");
  }

  async function deleteMod(mod) {
    setModContextMenu(null);
    if (!mod?.installed || !mod.path) {
      setNotice("Only installed local mods can be deleted.");
      return;
    }

    const name = modDisplayName(mod);
    if (!window.confirm(`Delete "${name}" from disk?`)) return;

    setLoading((current) => ({ ...current, mods: true }));
    setError("");
    setNotice(`Deleting ${name}...`);
    try {
      const result = await launcherApi.deleteMod(modActionPayload(mod));
      await scanModsIntoState();
      if (result.ok) {
        const warning = result.warnings?.[0] ? ` ${result.warnings[0]}` : "";
        setNotice(`${name} deleted.${warning}`);
      } else {
        setError(result.message || `Could not delete ${name}.`);
        setNotice("Delete did not finish.");
      }
    } catch (err) {
      setError(`Could not delete ${name}: ${err.message}`);
    } finally {
      setLoading((current) => ({ ...current, mods: false }));
    }
  }

  async function deleteAllMods(sourceMods = mods) {
    const targets = sourceMods.filter((mod) => mod?.installed && mod.path);
    if (!targets.length) {
      setNotice("No installed local mods were found to delete.");
      return;
    }

    if (!window.confirm(`Delete ${targets.length} installed mods from disk? Steam Workshop items will be unsubscribed when possible.`)) return;

    setLoading((current) => ({ ...current, mods: true }));
    setError("");
    setNotice(`Deleting ${targets.length} mods...`);
    try {
      const result = await launcherApi.deleteMods({ mods: targets.map(modActionPayload) });
      await scanModsIntoState();
      const failed = result.failed || [];
      const deletedCount = result.deleted?.length || 0;
      if (failed.length) {
        setError(failed.slice(0, 3).map((item) => item.message || `Could not delete ${item.mod?.name || "a mod"}.`).join(" "));
        setNotice(`Deleted ${deletedCount} mods; ${failed.length} could not be deleted.`);
      } else {
        const warnings = (result.results || []).flatMap((item) => item.warnings || []);
        setNotice(warnings.length ? `Deleted ${deletedCount} mods. ${warnings[0]}` : `Deleted ${deletedCount} mods.`);
      }
    } catch (err) {
      setError(`Could not delete mods: ${err.message}`);
    } finally {
      setLoading((current) => ({ ...current, mods: false }));
    }
  }

  async function stopWorkshopSync() {
    if (stoppingSync) return;
    setStoppingSync(true);
    setNotice("Stopping Steam Workshop sync...");
    try {
      const result = await launcherApi.stopWorkshopSync();
      if (!result.ok && result.message) {
        setNotice(result.message);
        setStoppingSync(false);
      }
    } catch (err) {
      setStoppingSync(false);
      setError(`Could not stop Steam Workshop sync: ${err.message}`);
    }
  }

  async function probeSteam() {
    setError("");
    setNotice("Checking Steamworks connection...");
    try {
      const info = await launcherApi.probeSteam();
      setSteamInfo(info);
      setNotice(`Steam connected as ${info.playerName}. ${info.subscribedCount} DayZ Workshop subscriptions visible.`);
    } catch (err) {
      setSteamInfo({ ok: false, message: err.message });
      setError(`Steamworks check failed: ${err.message}`);
    }
  }

  async function launchServer(server) {
    if (!server) return;
    setSelectedId(server.id);
    setLoading((current) => ({ ...current, launch: true }));
    setError("");
    try {
      const modPaths = (server.modIds || [])
        .map((id) => mods.find((mod) => String(mod.id) === String(id))?.path)
        .filter(Boolean);
      const result = await launcherApi.launch({
        server,
        playerName: state.playerName,
        modPaths,
        extraArgs: state.launchExtraArgs,
        preferBattlEye: state.preferBattlEye
      });
      setNotice(result.mode === "direct-exe"
        ? result.steamStatus?.started ? "Steam started; DayZ launch command sent." : "DayZ launch command sent."
        : result.message);
      await updateState({
        recents: [server, ...(state.recents || []).filter((item) => item.id !== server.id)].slice(0, 20)
      });
    } catch (err) {
      setError(`Launch failed: ${err.message}`);
    } finally {
      setLoading((current) => ({ ...current, launch: false }));
    }
  }

  async function launchSelected() {
    await launchServer(selectedServer);
  }

  async function openExternalLink(url) {
    if (!url) return;
    setError("");
    try {
      await launcherApi.openExternal(url);
    } catch (err) {
      setError(`Could not open link: ${err.message}`);
    }
  }

  async function checkUpdates() {
    setError("");
    try {
      const update = await launcherApi.checkForUpdates();
      setAppInfo((current) => ({ ...current, update: { ...defaultUpdateStatus, ...update } }));
    } catch (err) {
      setError(`Update check failed: ${err.message}`);
    }
  }

  async function installUpdate() {
    setError("");
    try {
      const update = await launcherApi.installUpdate();
      setAppInfo((current) => ({ ...current, update: { ...defaultUpdateStatus, ...update } }));
    } catch (err) {
      setError(`Update install failed: ${err.message}`);
    }
  }

  return (
    <div className="appShell">
      <aside className="rail">
        <div className="brand">
          <img className="brandMark" src="./icon.svg" alt="" aria-hidden="true" />
          <span>Ranger for DayZ</span>
        </div>
        <button className={classNames("railButton", activeView === "servers" && "active")} onClick={() => setActiveView("servers")} title="Servers">
          <Server size={19} />
          <span>Servers</span>
        </button>
        <button className={classNames("railButton", activeView === "mods" && "active")} onClick={() => setActiveView("mods")} title="Mods">
          <Download size={19} />
          <span>Mods</span>
        </button>
        <button className={classNames("railButton", activeView === "history" && "active")} onClick={() => setActiveView("history")} title="History">
          <History size={19} />
          <span>History</span>
        </button>
        <button className={classNames("railButton", activeView === "settings" && "active")} onClick={() => setActiveView("settings")} title="Settings">
          <Settings size={19} />
          <span>Settings</span>
        </button>
        <button className={classNames("railButton", activeView === "about" && "active")} onClick={() => setActiveView("about")} title="About">
          <Info size={19} />
          <span>About</span>
        </button>
        <button className="railButton supportButton" onClick={() => openExternalLink(appInfo.fundingUrl)} title="Support Ranger for DayZ" disabled={!appInfo.fundingUrl}>
          <Heart size={19} />
          <span>Support</span>
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="searchBox">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && refreshServers()}
              placeholder="Search server, map, IP, country"
            />
            {query && (
              <button className="iconButton" onClick={() => setQuery("")} title="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="discoveryStatus" title="Background discovery progress">
            {discoveryLabel(discovery, servers.length)}
          </div>
          <button className="toolButton" onClick={() => refreshServers()} disabled={loading.servers}>
            {loading.servers ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
            {loading.servers ? "Discovering" : "Refresh"}
          </button>
        </header>

        {notice && <div className="notice">{notice}</div>}
        {error && <div className="error">{error}</div>}

        {activeView === "servers" && (
          <section className="workspace">
            <div className="serverPanel">
              <div className="filterStrip">
                <span className="filterLabel"><Filter size={16} /> Filters</span>
                <div className="perspectiveFilter">
                  <span>Perspective</span>
                  <div className="segmentedControl" role="group" aria-label="Perspective filter">
                    {[
                      ["all", "All"],
                      ["firstPerson", "1PP"],
                      ["thirdPerson", "3PP"]
                    ].map(([value, label]) => (
                      <button
                        type="button"
                        className={classNames(filters.perspective === value && "active")}
                        key={value}
                        onClick={() => setFilters((current) => ({ ...current, perspective: value }))}
                        aria-pressed={filters.perspective === value}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mapFilter" ref={mapFilterRef}>
                  <span>Map</span>
                  <span className="mapInputWrap">
                    <input
                      value={filters.map}
                      onChange={(event) => {
                        setFilters((current) => ({ ...current, map: event.target.value }));
                        setMapMenuOpen(true);
                      }}
                      onFocus={(event) => {
                        event.currentTarget.select();
                        setMapMenuOpen(true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.currentTarget.blur();
                          setFilters((current) => ({ ...current, map: "" }));
                          setMapMenuOpen(false);
                        } else if (event.key === "ArrowDown") {
                          setMapMenuOpen(true);
                        }
                      }}
                      placeholder="All maps"
                      title="Type a map, choose one, or press Escape to clear"
                    />
                    {filters.map && (
                      <button
                        type="button"
                        className="mapClearButton"
                        onClick={() => {
                          setFilters((current) => ({ ...current, map: "" }));
                          setMapMenuOpen(true);
                        }}
                        title="Show all maps"
                        aria-label="Show all maps"
                      >
                        <X size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="mapMenuButton"
                      onClick={() => setMapMenuOpen((current) => !current)}
                      title="Show map options"
                      aria-label="Show map options"
                      aria-expanded={mapMenuOpen}
                      aria-controls="map-options-menu"
                    >
                      <ChevronDown size={14} />
                    </button>
                    {mapMenuOpen && (
                      <div className="mapMenu" id="map-options-menu" role="listbox">
                        <button
                          type="button"
                          className={classNames("mapOption", !filters.map && "selected")}
                          onClick={() => {
                            setFilters((current) => ({ ...current, map: "" }));
                            setMapMenuOpen(false);
                          }}
                          role="option"
                          aria-selected={!filters.map}
                        >
                          All maps
                        </button>
                        {visibleMapOptions.map((map) => (
                          <button
                            type="button"
                            className={classNames("mapOption", mapKey(filters.map) === mapKey(map) && "selected")}
                            key={map}
                            onClick={() => {
                              setFilters((current) => ({ ...current, map }));
                              setMapMenuOpen(false);
                            }}
                            role="option"
                            aria-selected={mapKey(filters.map) === mapKey(map)}
                          >
                            {map}
                          </button>
                        ))}
                        {!visibleMapOptions.length && <div className="mapOption empty">No maps found</div>}
                      </div>
                    )}
                  </span>
                </div>
                {Object.entries({
                  hideFull: "Not full",
                  hideEmpty: "Has players",
                  noPassword: "No password",
                  moddedOnly: "Modded",
                  officialOnly: "Official",
                  favoritesOnly: "Favorites"
                }).map(([key, label]) => (
                  <label className="toggle" key={key}>
                    <input
                      type="checkbox"
                      checked={filters[key]}
                      onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div className="serverTable" style={serverTableStyle}>
                <div className="tableHead" ref={tableHeadRef}>
                  {serverTableColumns.map((column, index) => (
                    <div className="tableHeadCell" key={column.key}>
                      <button onClick={() => changeSort(column.key)}>{column.label}{sortIndicator(column.key)}</button>
                      <span
                        className="columnResizeHandle"
                        onPointerDown={(event) => startColumnResize(index, event)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${column.label} column`}
                        tabIndex={-1}
                      />
                    </div>
                  ))}
                </div>
                <div className="serverList">
                  {filteredServers.map((server) => {
                    const favorite = state.favorites?.includes(server.id);
                    const selectServer = () => setSelectedId(server.id);
                    return (
                      <div
                        className={classNames(
                          "serverRow",
                          selectedServer?.id === server.id && "selected",
                          refreshingServerId === server.id && "refreshing"
                        )}
                        key={server.id}
                        onClick={selectServer}
                        onContextMenu={(event) => openServerContextMenu(event, server)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectServer();
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <span className="serverName">
                          <button
                            type="button"
                            className={classNames("favoriteButton", favorite && "favorite")}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavorite(server);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            aria-label={favorite ? "Remove favorite" : "Add favorite"}
                            title={favorite ? "Remove favorite" : "Add favorite"}
                          >
                            <Star size={16} fill={favorite ? "currentColor" : "none"} />
                          </button>
                          <span>{server.name}</span>
                        </span>
                        <span>
                          {server.players}/{server.maxPlayers || "?"}
                          <i style={{ width: `${percent(server)}%` }} />
                        </span>
                        <span className={classNames("pingCell", pingTone(server))} title={pingTitle(server)}>
                          {pingLabel(server)}
                        </span>
                        <span>{server.map}</span>
                        <span>{server.rank ? `#${server.rank}` : "Live"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {serverContextMenu && contextServer && (
                <div
                  className="serverContextMenu"
                  style={{ left: serverContextMenu.x, top: serverContextMenu.y }}
                  role="menu"
                >
                  <button
                    type="button"
                    onClick={() => playServerFromMenu(contextServer)}
                    disabled={loading.launch}
                    role="menuitem"
                  >
                    {loading.launch ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                    Play
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshSingleServer(contextServer)}
                    disabled={refreshingServerId === contextServer.id}
                    role="menuitem"
                  >
                    {refreshingServerId === contextServer.id ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                    Refresh
                  </button>
                </div>
              )}
            </div>

            <ServerDetails
              server={selectedServer}
              favorite={state.favorites?.includes(selectedServer?.id)}
              mods={mods}
              status={selectedModStatus}
              loading={loading}
              syncProgress={syncProgress}
              playerName={state.playerName}
              setPlayerName={(playerName) => updateState({ playerName })}
              onFavorite={() => toggleFavorite(selectedServer)}
              onMissingMods={openMissingMods}
              onSyncMods={syncMissingMods}
              onModContextMenu={openModContextMenu}
              onStopSync={stopWorkshopSync}
              onLaunch={launchSelected}
              stoppingSync={stoppingSync}
            />
          </section>
        )}

        {activeView === "mods" && (
          <ModsView
            mods={mods}
            paths={paths}
            loading={loading.mods}
            onRefresh={refreshMods}
            onSyncAll={() => syncAllMods(mods)}
            onDeleteAll={() => deleteAllMods(mods)}
            onModContextMenu={openModContextMenu}
          />
        )}
        {activeView === "history" && <HistoryView recents={state.recents || []} favorites={state.favorites || []} onSelect={(server) => {
          setServers((current) => current.some((item) => item.id === server.id) ? current : [server, ...current]);
          setSelectedId(server.id);
          setActiveView("servers");
        }} />}
        {activeView === "settings" && (
          <SettingsView
            paths={paths}
            state={state}
            steamInfo={steamInfo}
            onChange={updateState}
            onProbeSteam={probeSteam}
            onDetect={async () => {
              const detected = await launcherApi.detectPaths();
              setPaths({ ...emptyPaths, ...detected });
              setNotice("Paths refreshed.");
            }}
          />
        )}
        {activeView === "about" && (
          <AboutView
            appInfo={appInfo}
            onCheckUpdates={checkUpdates}
            onInstallUpdate={installUpdate}
            onOpenExternal={openExternalLink}
          />
        )}
        {modContextMenu && (
          <div
            className="modContextMenu"
            style={{ left: modContextMenu.x, top: modContextMenu.y }}
            role="menu"
          >
            <button
              type="button"
              onClick={() => syncMod(modContextMenu.mod)}
              disabled={!isSyncableMod(modContextMenu.mod) || loading.mods}
              title={isSyncableMod(modContextMenu.mod) ? "Sync this Workshop mod through Steam" : "No Workshop ID available"}
              role="menuitem"
            >
              {loading.mods ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
              Sync
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => deleteMod(modContextMenu.mod)}
              disabled={!modContextMenu.mod.installed || !modContextMenu.mod.path || loading.mods}
              title={modContextMenu.mod.installed ? "Delete this local mod folder" : "This mod is not installed locally"}
              role="menuitem"
            >
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function ServerDetails({
  server,
  favorite,
  mods,
  status,
  loading,
  syncProgress,
  playerName,
  setPlayerName,
  onFavorite,
  onMissingMods,
  onSyncMods,
  onModContextMenu,
  onStopSync,
  onLaunch,
  stoppingSync
}) {
  if (!server) {
    return (
      <aside className="details empty">
        <Server size={34} />
        <span>No server selected</span>
      </aside>
    );
  }

  const installedMods = server.modIds
    .map((id, index) => mods.find((mod) => String(mod.id) === String(id)) || {
      id,
      name: server.modNames?.[index] || `Workshop ${id}`,
      installed: false
    })
    .slice(0, 24);
  const syncItems = new Map((syncProgress.items || []).map((item) => [String(item.id), item]));
  const modSummaryText = status.total
    ? status.blocked?.length
      ? `${status.playableInstalled}/${status.playableTotal} playable mods installed; ${status.blocked.length} stale listing ${status.blocked.length === 1 ? "entry" : "entries"} ignored`
      : `${status.installed}/${status.total} required mods installed`
    : "No published mod list found";
  const serverType = server.modded || (server.modIds || []).length ? "Modded" : "Vanilla";

  return (
    <aside className="details">
      <div className="detailsHeader">
        <div>
          <p>{server.ip}:{server.port}</p>
          <h1>{server.name}</h1>
        </div>
        <button className="iconButton large" onClick={onFavorite} title="Toggle favorite">
          <Star size={20} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="statGrid">
        <div><strong>{server.players}/{server.maxPlayers || "?"}</strong><span>Players</span></div>
        <div><strong>{server.map}</strong><span>Map</span></div>
        <div><strong>{server.firstPerson ? "1PP" : "3PP"}</strong><span>Perspective</span></div>
        <div><strong>{serverType}</strong><span>Server type</span></div>
        <div><strong>{server.version || "Unknown"}</strong><span>Version</span></div>
      </div>

      <div className="launchBox">
        <label>
          In-game name
          <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
        </label>
        <button className="primaryButton" onClick={onLaunch} disabled={loading.launch}>
          {loading.launch ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          Join Server
        </button>
      </div>

      <div className="modSummary">
        <div>
          <Activity size={18} />
          <span title={modSummaryText}>{modSummaryText}</span>
        </div>
        <button className="toolButton syncButton" onClick={onSyncMods} disabled={!status.missing.length || loading.mods}>
          <Download size={16} />
          Sync Missing
        </button>
      </div>

      <SyncProgress
        progress={syncProgress}
        missingCount={status.missing.length}
        mods={installedMods}
        onStop={onStopSync}
        stopping={stoppingSync}
      />

      <div className="modList">
        {installedMods.length ? installedMods.map((mod) => {
          const itemProgress = syncItems.get(String(mod.id));
          const isMissing = !mod.installed;
          const fill = Math.max(0, Math.min(100, Number(itemProgress?.progress) || (mod.installed ? 100 : 0)));
          const showProgress = isMissing && syncProgress.phase !== "idle" && itemProgress;
          const name = modDisplayName(mod);
          const detail = showProgress ? itemProgress.failed ? shortIssue(itemProgress.issue) : syncItemDetail(itemProgress) : mod.installed ? mod.source : String(mod.id || "");
          return (
            <div
              className={classNames("modItem", isMissing && "missing", showProgress && "syncing", itemProgress?.failed && "issue", isWorkshopItemReady(itemProgress) && "ready")}
              key={String(mod.id)}
              title={`${name}${detail ? ` - ${detail}` : ""}`}
              onContextMenu={(event) => onModContextMenu(event, mod, "server")}
            >
              {showProgress && <i className="modProgressFill" style={{ width: `${fill}%` }} />}
              <span>{name}</span>
              <small>{detail}</small>
            </div>
          );
        }) : (
          <div className="hint">
            Some public server lists do not expose required Workshop IDs. Join will still connect, and Steam/DayZ may prompt for missing mods.
          </div>
        )}
      </div>

      <button className="linkButton" onClick={() => launcherApi.openSteam(server.sourceUrl)}>
        <ExternalLink size={16} />
        BattleMetrics profile
      </button>
      <button className="linkButton" onClick={onMissingMods} disabled={!status.missing.length}>
        <ExternalLink size={16} />
        Open missing Workshop pages
      </button>
    </aside>
  );
}

function SyncProgress({ progress, missingCount, mods = [], onStop, stopping = false }) {
  if (!missingCount || !progress || progress.phase === "idle") return null;
  const items = progress.items || [];
  const completed = items.filter(isWorkshopItemReady).length;
  const blocked = items.filter((item) => item.failed).length;
  const stopped = items.filter((item) => item.stopped).length;
  const stale = items.filter((item) => item.failed && item.unrecoverable).length;
  const total = items.length || missingCount;
  const handled = items.filter(isWorkshopItemDone).length;
  const average = items.length
    ? Math.round(items.reduce((sum, item) => sum + (isWorkshopItemReady(item) ? 100 : item.progress || 0), 0) / items.length)
    : 0;
  const activeItem = items.find((item) => progress.activeId && String(item.id) === String(progress.activeId))
    || items.find((item) => item.downloading)
    || items.find((item) => item.failed)
    || items.find((item) => item.downloadPending || item.needsUpdate)
    || items.find((item) => !isWorkshopItemReady(item));
  const activeMod = activeItem ? mods.find((mod) => String(mod.id) === String(activeItem.id)) : null;
  const activeName = activeMod ? modDisplayName(activeMod) : (activeItem ? `Workshop ${activeItem.id}` : "");
  const statusText = activeItem
    ? `${syncItemLabel(activeItem)}: ${activeName} - ${activeItem.failed ? shortIssue(activeItem.issue) : syncItemDetail(activeItem)}`
    : progress.phase === "complete"
      ? "All missing Workshop mods are ready."
      : progress.phase === "stopped"
        ? "Workshop sync stopped."
      : progress.phase;
  const title = progress.phase === "complete"
    ? "Workshop sync complete"
    : progress.phase === "stopped"
      ? "Workshop sync stopped"
    : progress.phase === "failed" || progress.phase === "stalled" || progress.phase === "timeout"
      ? stale && stale === blocked ? "Stale Workshop entries ignored" : "Workshop sync needs attention"
      : "Steam Workshop sync";
  const summary = stale && stale === blocked
    ? `${stale} ignored`
    : blocked
      ? `${completed}/${total} ready, ${blocked} blocked`
      : stopped
        ? `${completed}/${total} ready, ${stopped} stopped`
      : `${completed}/${total} ready`;
  const canStop = Boolean(onStop && ["starting", "subscribing", "downloading", "waiting"].includes(progress.phase));
  const checkedAt = progress.updatedAt
    ? new Date(progress.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : "";

  return (
    <div className={classNames("syncBox", blocked && "blocked")}>
      <div className="syncTop">
        <strong>{title}</strong>
        <span>{summary}</span>
        {canStop && (
          <button className="syncStopButton" type="button" onClick={onStop} disabled={stopping}>
            {stopping ? <Loader2 className="spin" size={14} /> : <X size={14} />}
            Stop
          </button>
        )}
      </div>
      <div className="progressTrack">
        <i style={{ width: `${average}%` }} />
      </div>
      <small className="syncDetail">{statusText}{blocked ? ` - ${handled}/${total} handled` : ""}</small>
      <small className="syncMeta">{checkedAt ? `Checked ${checkedAt}` : progress.phase}{progress.failed?.length ? ` - ${progress.failed.length} issue(s)` : ""}</small>
      <small>{progress.phase}{progress.failed?.length ? ` · ${progress.failed.length} issue(s)` : ""}</small>
    </div>
  );
}

function ModsView({ mods, paths, loading, onRefresh, onSyncAll, onDeleteAll, onModContextMenu }) {
  const syncableCount = mods.filter(isSyncableMod).length;

  return (
    <section className="singlePanel">
      <div className="sectionHeader">
        <div>
          <h2>Local Mods</h2>
          <p>{mods.length} installed mods detected across Steam Workshop, `!dzsal`, and the DayZ folder.</p>
        </div>
        <div className="sectionActions">
          <button className="toolButton" onClick={onSyncAll} disabled={loading || !syncableCount}>
            {loading ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
            Sync All
          </button>
          <button className="toolButton danger" onClick={onDeleteAll} disabled={loading || !mods.length}>
            <Trash2 size={17} />
            Delete All
          </button>
          <button className="toolButton" onClick={onRefresh} disabled={loading}>
            {loading ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
            Rescan
          </button>
        </div>
      </div>
      <div className="pathGrid">
        <PathRow label="DayZ" value={paths.dayzPath} />
        <PathRow label="Workshop" value={paths.workshopPath} />
        <PathRow label="DZSA Mods" value={paths.dzsaPath} />
      </div>
      <div className="modsGrid">
        {mods.map((mod) => (
          <div
            className="localMod"
            key={`${mod.id}-${mod.path}`}
            onContextMenu={(event) => onModContextMenu(event, mod, "mods")}
            title="Right-click for Sync and Delete"
          >
            <strong>{mod.name}</strong>
            <span>{mod.source}</span>
            <small>{mod.id}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryView({ recents, favorites, onSelect }) {
  return (
    <section className="singlePanel">
      <div className="sectionHeader">
        <div>
          <h2>Recent Servers</h2>
          <p>Recently launched servers stay here even when the live list refreshes.</p>
        </div>
      </div>
      <div className="historyList">
        {recents.map((server) => (
          <button key={server.id} className="historyRow" onClick={() => onSelect(server)}>
            <span>{favorites.includes(server.id) ? <Star size={16} fill="currentColor" /> : <History size={16} />}</span>
            <strong>{server.name}</strong>
            <small>{server.ip}:{server.port} · {server.map} · {server.players}/{server.maxPlayers}</small>
          </button>
        ))}
        {!recents.length && <div className="hint">Servers you launch will appear here.</div>}
      </div>
    </section>
  );
}

function updateTone(status) {
  if (["current", "downloaded"].includes(status)) return "good";
  if (["checking", "downloading", "installing"].includes(status)) return "active";
  if (status === "error") return "bad";
  return "neutral";
}

function AboutView({ appInfo, onCheckUpdates, onInstallUpdate, onOpenExternal }) {
  const update = { ...defaultUpdateStatus, ...appInfo.update };
  const versions = appInfo.versions || {};
  const isBusy = Boolean(update.checking || ["checking", "downloading", "installing"].includes(update.status));
  const canInstall = update.status === "downloaded";
  const updateVersion = update.updateInfo?.version || "";

  return (
    <section className="singlePanel">
      <div className="sectionHeader">
        <div>
          <h2>About</h2>
          <p>{appInfo.description || "Unofficial DayZ server browser, mod helper, and launcher."}</p>
        </div>
        <img className="aboutMark" src="./icon.svg" alt="" aria-hidden="true" />
      </div>

      <div className="aboutGrid">
        <InfoRow label="App" value={appInfo.productName || "Ranger for DayZ"} />
        <InfoRow label="Version" value={appInfo.version || "Unknown"} />
        <InfoRow label="Build" value={appInfo.isPackaged ? "Packaged" : "Development"} />
        <InfoRow label="Platform" value={[appInfo.platform, appInfo.arch].filter(Boolean).join(" ") || "Unknown"} />
        <InfoRow label="Electron" value={versions.electron || "Preview"} />
        <InfoRow label="Chrome" value={versions.chrome || "Preview"} />
        <InfoRow label="Node" value={versions.node || "Preview"} />
        <InfoRow label="License" value={appInfo.license || "Unknown"} />
      </div>

      <div className="updatePanel">
        <div className="updateHeader">
          <div>
            <strong>Updates</strong>
            <span className={classNames("updateStatus", updateTone(update.status))}>{update.message}</span>
          </div>
          {updateVersion && <small>Latest: {updateVersion}</small>}
        </div>
        {update.status === "downloading" && (
          <div className="updateProgress" aria-label="Update download progress">
            <span style={{ width: `${Math.max(0, Math.min(100, Number(update.progress) || 0))}%` }} />
          </div>
        )}
        <div className="aboutActions">
          <button className="toolButton" onClick={onCheckUpdates} disabled={isBusy}>
            {isBusy ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
            Check
          </button>
          <button className="toolButton" onClick={onInstallUpdate} disabled={!canInstall}>
            <Download size={17} />
            Install
          </button>
          <button className="toolButton" onClick={() => onOpenExternal(appInfo.latestReleaseUrl)} disabled={!appInfo.latestReleaseUrl}>
            <ExternalLink size={17} />
            Releases
          </button>
        </div>
      </div>

      <div className="aboutLinks">
        <button className="linkButton" onClick={() => onOpenExternal(appInfo.repositoryUrl)} disabled={!appInfo.repositoryUrl}>
          <ExternalLink size={16} />
          GitHub
        </button>
        <button className="linkButton supportLink" onClick={() => onOpenExternal(appInfo.fundingUrl)} disabled={!appInfo.fundingUrl}>
          <Heart size={16} />
          Support
        </button>
        <button className="linkButton" onClick={() => onOpenExternal(appInfo.licenseUrl)} disabled={!appInfo.licenseUrl}>
          <ExternalLink size={16} />
          License
        </button>
        <button className="linkButton" onClick={() => onOpenExternal(appInfo.noticesUrl)} disabled={!appInfo.noticesUrl}>
          <ExternalLink size={16} />
          Notices
        </button>
      </div>

      <p className="aboutDisclaimer">
        Ranger for DayZ is an unofficial community tool and is not affiliated with Bohemia Interactive, DayZ, Valve, Steam, or BattleMetrics.
      </p>
    </section>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="infoRow">
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function SettingsView({ paths, state, steamInfo, onChange, onProbeSteam, onDetect }) {
  return (
    <section className="singlePanel">
      <div className="sectionHeader">
        <div>
          <h2>Settings</h2>
          <p>Detected Steam and DayZ paths plus launch behavior.</p>
        </div>
        <button className="toolButton" onClick={onDetect}>
          <SlidersHorizontal size={17} />
          Detect
        </button>
      </div>
      <div className="settingsGrid">
        <PathRow label="Steam" value={paths.steamPath} />
        <PathRow label="DayZ" value={paths.dayzPath} />
        <PathRow label="Launcher exe" value={paths.dayzExe || paths.dayzRawExe} />
      </div>
      <div className="settingsForm">
        <button className="toolButton settingsAction" onClick={onProbeSteam}>
          <Activity size={17} />
          Check Steamworks
        </button>
        {steamInfo && (
          <div className={classNames("steamInfo", steamInfo.ok === false && "bad")}>
            {steamInfo.ok === false ? (
              <span>{steamInfo.message || "Steamworks is not connected."}</span>
            ) : (
              <span>{steamInfo.playerName} · app {steamInfo.appId} · {steamInfo.subscribedCount} subscriptions</span>
            )}
          </div>
        )}
        <label>
          Default survivor name
          <input value={state.playerName} onChange={(event) => onChange({ playerName: event.target.value })} />
        </label>
        <label>
          Extra launch args
          <input
            value={state.launchExtraArgs}
            onChange={(event) => onChange({ launchExtraArgs: event.target.value })}
            placeholder="-nosplash -skipIntro"
          />
        </label>
        <label className="checkLine">
          <input
            type="checkbox"
            checked={state.preferBattlEye}
            onChange={(event) => onChange({ preferBattlEye: event.target.checked })}
          />
          <Shield size={16} />
          Use BattlEye launcher when available
        </label>
      </div>
    </section>
  );
}

function PathRow({ label, value }) {
  return (
    <div className="pathRow">
      <strong>{label}</strong>
      <span className={value ? "" : "missingText"}>{pathLabel(value)}</span>
    </div>
  );
}

export default App;
