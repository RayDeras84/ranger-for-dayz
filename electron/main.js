import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import { execFile, execFileSync } from "node:child_process";
import dgram from "node:dgram";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferMapFromText,
  isAllowedExternalUrl as isAllowedExternalUrlCore,
  normalizeFundingUrl,
  normalizeMapName,
  normalizeRepositoryUrl,
  parseVdfObject,
  pingStatusFromMs
} from "./core-utils.mjs";
import { selectDzsaServers, migrateServerState } from "./server-utils.mjs";
import { createServerCatalog, refreshServerDetails } from "./server-catalog.mjs";
import { startBackgroundUpdateChecks } from "./update-checks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json");
const { autoUpdater } = require("electron-updater");
const isDev = !app.isPackaged && process.argv.includes("--dev");
const smokeTest = process.argv.includes("--smoke-test");
const rendererSmokeTest = process.argv.includes("--renderer-smoke-test");
const steamProbeTest = process.argv.includes("--steam-probe-test");
const steamSyncTestArg = process.argv.find((arg) => arg.startsWith("--steam-sync-test="));
const serverFetchTest = process.argv.includes("--server-fetch-test");
const DAYZ_APP_ID = "221100";
const WORKSHOP_ROOT_ID = "221100";
const ITEM_STATE = {
  SUBSCRIBED: 1,
  LEGACY_ITEM: 2,
  INSTALLED: 4,
  NEEDS_UPDATE: 8,
  DOWNLOADING: 16,
  DOWNLOAD_PENDING: 32
};
let steamClient = null;
let serverDiscoveryRun = 0;
let workshopSyncRun = 0;
let workshopSyncCancel = null;
const fetchDzsaServerCatalog = createServerCatalog();
let stopBackgroundUpdateChecks = null;
let updateStatus = {
  status: "idle",
  message: "Updates have not been checked yet.",
  checking: false,
  progress: 0,
  updateInfo: null,
  error: ""
};

const userDataPath = () => app.getPath("userData");
const settingsPath = () => path.join(userDataPath(), "settings.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeSteamAppIdFiles() {
  const targets = new Set([
    process.cwd(),
    path.dirname(process.execPath),
    isDev ? path.join(__dirname, "..") : process.resourcesPath
  ]);

  for (const target of targets) {
    try {
      if (!target || !fs.existsSync(target)) continue;
      fs.writeFileSync(path.join(target, "steam_appid.txt"), DAYZ_APP_ID);
    } catch {
      // Some packaged locations may be read-only; one writable app id file is enough.
    }
  }
}

function getRepositoryUrl() {
  return normalizeRepositoryUrl(packageMetadata.homepage)
    || normalizeRepositoryUrl(packageMetadata.repository?.url)
    || "";
}

function getFundingUrl() {
  const funding = packageMetadata.funding;
  if (Array.isArray(funding)) {
    return funding.map((entry) => normalizeFundingUrl(entry)).find(Boolean) || "";
  }
  return normalizeFundingUrl(funding);
}

function getAppInfo() {
  const repositoryUrl = getRepositoryUrl();
  return {
    name: app.getName(),
    productName: packageMetadata.build?.productName || "Ranger for DayZ",
    version: app.getVersion(),
    description: packageMetadata.description || "",
    license: packageMetadata.license || "",
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    repositoryUrl,
    releasesUrl: repositoryUrl ? `${repositoryUrl}/releases` : "",
    latestReleaseUrl: repositoryUrl ? `${repositoryUrl}/releases/latest` : "",
    licenseUrl: repositoryUrl ? `${repositoryUrl}/blob/main/LICENSE` : "",
    noticesUrl: repositoryUrl ? `${repositoryUrl}/blob/main/THIRD_PARTY_NOTICES.md` : "",
    fundingUrl: getFundingUrl(),
    update: updateStatus
  };
}

function emitUpdateStatus(patch) {
  updateStatus = {
    ...updateStatus,
    ...patch,
    checkedAt: new Date().toISOString()
  };

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("app:update-status", updateStatus);
  }

  return updateStatus;
}

function explainUpdateError(error) {
  const message = String(error?.message || error || "Could not check for updates.");
  if (/app-update\.yml|latest\.yml|No published versions|Cannot find|404/i.test(message)) {
    return "No published update feed was found. A GitHub Release with installer update files is required before updates can install automatically.";
  }
  return message;
}

function updatesCanRun() {
  return app.isPackaged && process.platform === "win32";
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    emitUpdateStatus({
      status: "checking",
      message: "Checking for updates...",
      checking: true,
      progress: 0,
      error: ""
    });
  });

  autoUpdater.on("update-available", (info) => {
    emitUpdateStatus({
      status: "downloading",
      message: `Downloading version ${info.version}...`,
      checking: false,
      progress: 0,
      updateInfo: info,
      error: ""
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    emitUpdateStatus({
      status: "downloading",
      message: `Downloading update ${Math.round(progress.percent || 0)}%`,
      checking: false,
      progress: Math.round(progress.percent || 0),
      error: ""
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    emitUpdateStatus({
      status: "current",
      message: `Ranger for DayZ ${app.getVersion()} is up to date.`,
      checking: false,
      progress: 0,
      updateInfo: info,
      error: ""
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    emitUpdateStatus({
      status: "downloaded",
      message: `Version ${info.version} is ready to install.`,
      checking: false,
      progress: 100,
      updateInfo: info,
      error: ""
    });
  });

  autoUpdater.on("error", (error) => {
    emitUpdateStatus({
      status: "error",
      message: explainUpdateError(error),
      checking: false,
      error: error?.message || String(error)
    });
  });
}

async function checkForUpdates() {
  if (!updatesCanRun()) {
    return emitUpdateStatus({
      status: "disabled",
      message: app.isPackaged
        ? "Automatic updates are only enabled for Windows builds."
        : "Automatic updates are available in packaged installer builds.",
      checking: false,
      progress: 0,
      error: ""
    });
  }

  if (updateStatus.checking || ["downloading", "downloaded", "installing"].includes(updateStatus.status)) {
    return updateStatus;
  }

  try {
    emitUpdateStatus({
      status: "checking",
      message: "Checking for updates...",
      checking: true,
      progress: 0,
      error: ""
    });
    const result = await autoUpdater.checkForUpdates();
    await result?.downloadPromise;
    return updateStatus;
  } catch (error) {
    return emitUpdateStatus({
      status: "error",
      message: explainUpdateError(error),
      checking: false,
      error: error?.message || String(error)
    });
  }
}

function installDownloadedUpdate() {
  if (updateStatus.status !== "downloaded") {
    return emitUpdateStatus({
      status: updateStatus.status,
      message: "No downloaded update is ready to install.",
      checking: false
    });
  }

  emitUpdateStatus({
    status: "installing",
    message: "Restarting to install the update...",
    checking: false
  });
  autoUpdater.quitAndInstall(false, true);
  return updateStatus;
}

function powershell(command) {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true
    }).trim();
  } catch {
    return "";
  }
}

function readSteamPathFromRegistry() {
  const candidates = [
    "HKCU:\\Software\\Valve\\Steam",
    "HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
    "HKLM:\\SOFTWARE\\Valve\\Steam"
  ];

  for (const key of candidates) {
    const value = powershell(`(Get-ItemProperty '${key}' -ErrorAction SilentlyContinue).SteamPath`);
    if (value && fs.existsSync(value)) return value.replaceAll("/", "\\");
  }

  const defaultPath = "C:\\Program Files (x86)\\Steam";
  return fs.existsSync(defaultPath) ? defaultPath : "";
}

function readVdf(filePath) {
  try {
    return parseVdfObject(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function getSteamLibraries(steamPath) {
  const libraries = new Set();
  if (steamPath) libraries.add(steamPath);

  const libraryFile = path.join(steamPath, "steamapps", "libraryfolders.vdf");
  const parsed = readVdf(libraryFile).libraryfolders ?? {};
  Object.values(parsed).forEach((entry) => {
    if (entry?.path) libraries.add(entry.path.replaceAll("\\\\", "\\"));
  });

  return [...libraries].filter(Boolean);
}

function findDayzInstall(steamPath) {
  for (const library of getSteamLibraries(steamPath)) {
    const manifest = path.join(library, "steamapps", `appmanifest_${DAYZ_APP_ID}.acf`);
    const appState = readVdf(manifest).AppState;
    if (appState?.installdir) {
      const install = path.join(library, "steamapps", "common", appState.installdir);
      if (fs.existsSync(path.join(install, "DayZ_x64.exe"))) return install;
    }
  }
  return "";
}

function getKnownPaths(overrides = {}) {
  const settings = readJson(settingsPath(), {});
  const steamPath = overrides.steamPath || settings.steamPath || readSteamPathFromRegistry();
  const dayzPath = overrides.dayzPath || settings.dayzPath || findDayzInstall(steamPath);
  const steamExe = steamPath ? path.join(steamPath, "steam.exe") : "";
  const dayzExe = dayzPath ? path.join(dayzPath, "DayZ_BE.exe") : "";
  const dayzRawExe = dayzPath ? path.join(dayzPath, "DayZ_x64.exe") : "";
  const workshopPath = steamPath
    ? getSteamLibraries(steamPath)
        .map((library) => path.join(library, "steamapps", "workshop", "content", WORKSHOP_ROOT_ID))
        .find((candidate) => fs.existsSync(candidate)) || ""
    : "";

  return {
    steamPath,
    dayzPath,
    steamExe: fs.existsSync(steamExe) ? steamExe : "",
    dayzExe: fs.existsSync(dayzExe) ? dayzExe : "",
    dayzRawExe: fs.existsSync(dayzRawExe) ? dayzRawExe : "",
    workshopPath,
    dzsaPath: dayzPath && fs.existsSync(path.join(dayzPath, "!dzsal")) ? path.join(dayzPath, "!dzsal") : ""
  };
}

function isSteamRunning() {
  try {
    const output = execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq steam.exe", "/NH"], {
      encoding: "utf8",
      windowsHide: true
    });
    return /\bsteam\.exe\b/i.test(output);
  } catch {
    return false;
  }
}

function launchSteamExecutable(steamExe, steamPath) {
  return new Promise((resolve) => {
    let settled = false;
    const child = execFile(steamExe, ["-silent"], {
      cwd: steamPath || path.dirname(steamExe),
      detached: true,
      windowsHide: false
    });

    function settle(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    child.once("spawn", () => {
      child.unref();
      settle({ ok: true, started: true, steamExe });
    });
    child.once("error", (error) => {
      settle({ ok: false, started: false, steamExe, message: error.message });
    });
  });
}

async function startSteamIfNeeded({ waitMs = 15000, pollMs = 500 } = {}) {
  if (isSteamRunning()) return { ok: true, running: true, started: false };

  const paths = getKnownPaths();
  let launchResult;
  if (paths.steamExe) {
    launchResult = await launchSteamExecutable(paths.steamExe, paths.steamPath);
  } else {
    try {
      await shell.openExternal("steam://open/main");
      launchResult = { ok: true, started: true, steamExe: "" };
    } catch (error) {
      return {
        ok: false,
        running: false,
        started: false,
        message: `Steam is not running and steam.exe was not found. ${error.message}`
      };
    }
  }

  if (!launchResult.ok) return { ...launchResult, running: false };

  const deadline = Date.now() + Math.max(0, waitMs);
  while (Date.now() < deadline) {
    await delay(pollMs);
    if (isSteamRunning()) {
      return { ...launchResult, ok: true, running: true };
    }
  }

  return {
    ...launchResult,
    ok: true,
    running: isSteamRunning(),
    message: "Steam was started and may still be signing in."
  };
}

function readMetaPublishedId(modFolder) {
  const metaPath = path.join(modFolder, "meta.cpp");
  if (!fs.existsSync(metaPath)) return "";
  const meta = fs.readFileSync(metaPath, "utf8");
  const match = meta.match(/publishedid\s*=\s*(\d+)/i);
  return match?.[1] && match[1] !== "0" ? match[1] : "";
}

function scanLocalMods(customPaths = {}) {
  const known = getKnownPaths(customPaths);
  const modsById = new Map();
  const looseMods = [];

  if (known.workshopPath && fs.existsSync(known.workshopPath)) {
    for (const entry of fs.readdirSync(known.workshopPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(known.workshopPath, entry.name);
      modsById.set(entry.name, {
        id: entry.name,
        name: readMetaName(fullPath) || `Workshop ${entry.name}`,
        path: fullPath,
        source: "Steam Workshop",
        installed: true,
        updatedAt: fs.statSync(fullPath).mtimeMs
      });
    }
  }

  for (const basePath of [known.dzsaPath, known.dayzPath]) {
    if (!basePath || !fs.existsSync(basePath)) continue;
    for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("@")) continue;
      const fullPath = path.join(basePath, entry.name);
      const publishedId = readMetaPublishedId(fullPath);
      const mod = {
        id: publishedId || entry.name,
        name: entry.name,
        path: fullPath,
        source: basePath.endsWith("!dzsal") ? "DZSA folder" : "DayZ folder",
        installed: true,
        updatedAt: fs.statSync(fullPath).mtimeMs
      };
      if (publishedId) modsById.set(publishedId, mod);
      else looseMods.push(mod);
    }
  }

  return {
    paths: known,
    mods: [...modsById.values(), ...looseMods].sort((a, b) => a.name.localeCompare(b.name))
  };
}

function canonicalPath(value) {
  return value && typeof value === "string" ? path.resolve(value).toLowerCase() : "";
}

function isNumericWorkshopId(value) {
  return /^\d+$/.test(String(value || ""));
}

function findScannedMod(payload = {}) {
  const scanned = scanLocalMods().mods;
  const requestedPath = canonicalPath(payload.path);
  if (requestedPath) {
    return scanned.find((mod) => canonicalPath(mod.path) === requestedPath) || null;
  }

  const requestedId = String(payload.id || "").trim();
  if (!requestedId) return null;
  const matches = scanned.filter((mod) => String(mod.id) === requestedId);
  return matches.length === 1 ? matches[0] : null;
}

function validateModDeleteTarget(payload = {}) {
  const mod = findScannedMod(payload);
  if (!mod?.path) {
    return { ok: false, message: "The selected mod was not found in the latest local mod scan." };
  }

  const fullPath = path.resolve(mod.path);
  let stats;
  try {
    stats = fs.lstatSync(fullPath);
  } catch {
    return { ok: false, mod, message: "The selected mod folder no longer exists." };
  }

  if (!stats.isDirectory()) {
    return { ok: false, mod, message: "Only detected mod folders can be deleted." };
  }

  const known = getKnownPaths();
  const roots = [known.workshopPath, known.dzsaPath, known.dayzPath]
    .filter(Boolean)
    .map((root) => path.resolve(root));
  const insideKnownRoot = roots.some((root) => {
    const relative = path.relative(root, fullPath);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  });

  if (!insideKnownRoot) {
    return { ok: false, mod, message: "The selected mod is outside the detected DayZ mod folders." };
  }

  return { ok: true, mod: { ...mod, path: fullPath } };
}

async function deleteLocalMod(payload = {}) {
  const target = validateModDeleteTarget(payload);
  if (!target.ok) return target;

  const { mod } = target;
  const warnings = [];

  if (mod.source === "Steam Workshop" && isNumericWorkshopId(mod.id)) {
    try {
      const client = await getSteamClient();
      await client.workshop.unsubscribe(BigInt(mod.id));
    } catch (error) {
      warnings.push(`Could not unsubscribe from Workshop ${mod.id}: ${error.message}`);
    }
  }

  let removal = "trash";
  try {
    await shell.trashItem(mod.path);
  } catch (trashError) {
    try {
      fs.rmSync(mod.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      removal = "delete";
      warnings.push("Recycle Bin was unavailable; the mod folder was permanently deleted.");
    } catch (deleteError) {
      return {
        ok: false,
        mod,
        warnings,
        message: `Could not delete ${mod.name}: ${deleteError.message || trashError.message}`
      };
    }
  }

  return { ok: true, mod, removal, warnings };
}

async function deleteLocalMods(payload = {}) {
  const items = Array.isArray(payload.mods) ? payload.mods : [];
  const results = [];
  for (const mod of items) {
    results.push(await deleteLocalMod(mod));
  }
  return {
    ok: results.every((result) => result.ok),
    results,
    deleted: results.filter((result) => result.ok).map((result) => result.mod),
    failed: results.filter((result) => !result.ok)
  };
}

async function getSteamClient({ waitReadyMs = 45000 } = {}) {
  if (steamClient && isSteamRunning()) return steamClient;
  if (steamClient && !isSteamRunning()) steamClient = null;

  const steamStatus = await startSteamIfNeeded({ waitMs: Math.min(waitReadyMs, 30000) });
  if (!steamStatus.ok) {
    throw new Error(steamStatus.message || "Steam is not available.");
  }

  writeSteamAppIdFiles();
  const steamworks = require("steamworks.js");
  const deadline = Date.now() + Math.max(1000, waitReadyMs);
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      steamClient = steamworks.init();
      return steamClient;
    } catch (error) {
      lastError = error;
      await delay(1000);
    }
  }

  const prefix = steamStatus.started
    ? "Steam was started but Steamworks could not connect yet."
    : "Steamworks could not connect to Steam.";
  throw new Error(`${prefix} Sign in to Steam, wait for it to finish loading, then retry. ${lastError?.message || ""}`.trim());
}

function stateFlags(state) {
  return {
    subscribed: Boolean(state & ITEM_STATE.SUBSCRIBED),
    installed: Boolean(state & ITEM_STATE.INSTALLED),
    needsUpdate: Boolean(state & ITEM_STATE.NEEDS_UPDATE),
    downloading: Boolean(state & ITEM_STATE.DOWNLOADING),
    downloadPending: Boolean(state & ITEM_STATE.DOWNLOAD_PENDING),
    legacyItem: Boolean(state & ITEM_STATE.LEGACY_ITEM)
  };
}

function serializeBigInt(value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function getWorkshopItemStatus(client, itemId) {
  const item = BigInt(itemId);
  const state = client.workshop.state(item);
  const flags = stateFlags(state);
  const installInfo = client.workshop.installInfo(item);
  const downloadInfo = client.workshop.downloadInfo(item);
  const current = serializeBigInt(downloadInfo?.current ?? 0n);
  const total = serializeBigInt(downloadInfo?.total ?? 0n);
  const progress = Number(total) > 0 ? Math.round((Number(current) / Number(total)) * 100) : flags.installed ? 100 : 0;

  return {
    id: String(itemId),
    state,
    ...flags,
    progress,
    currentBytes: current,
    totalBytes: total,
    folder: installInfo?.folder ?? "",
    sizeOnDisk: serializeBigInt(installInfo?.sizeOnDisk ?? 0n),
    timestamp: installInfo?.timestamp ?? 0
  };
}

function workshopResultMessage(result) {
  if (result === 9) {
    return "Workshop item is unavailable or not public. The server may be listing a deleted, private, or stale mod ID.";
  }
  if (result && result !== 1) {
    return `Steam Workshop metadata check failed with result ${result}.`;
  }
  return "";
}

async function getWorkshopFileDetails(itemIds) {
  if (!itemIds.length || typeof fetch !== "function") return new Map();
  const details = new Map();
  for (let start = 0; start < itemIds.length; start += 100) {
    const chunk = itemIds.slice(start, start + 100);
    const body = new URLSearchParams({ itemcount: String(chunk.length) });
    chunk.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/", {
        method: "POST",
        body,
        signal: controller.signal
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const item of data?.response?.publishedfiledetails || []) {
        details.set(String(item.publishedfileid), item);
      }
    } catch {
      // Metadata lookup is a helpful preflight, not required for Steam sync.
    } finally {
      clearTimeout(timeout);
    }
  }
  return details;
}

function emitSyncProgress(sender, payload) {
  sender?.send("steam:sync-progress", { ...payload, updatedAt: payload.updatedAt ?? Date.now() });
}

function mergeFailedItems(items, failed) {
  if (!failed.length) return items;
  const failures = new Map(failed.map((item) => [String(item.id), item.message || "Steam reported an issue."]));
  return items.map((item) => failures.has(item.id)
    ? { ...item, failed: true, issue: failures.get(item.id), downloadPending: false, downloading: false }
    : item
  );
}

function getSyncItemStatus(client, itemId, failed) {
  const failure = failed.find((item) => String(item.id) === String(itemId));
  if (failure) {
    return {
      id: String(itemId),
      state: 0,
      subscribed: false,
      installed: false,
      needsUpdate: false,
      downloading: false,
      downloadPending: false,
      legacyItem: false,
      progress: 0,
      currentBytes: "0",
      totalBytes: "0",
      failed: true,
      issue: failure.message,
      unrecoverable: Boolean(failure.unrecoverable)
    };
  }
  return getWorkshopItemStatus(client, itemId);
}

function isSyncItemReady(item) {
  return Boolean(item?.installed && !item.needsUpdate && !item.downloading && !item.downloadPending);
}

function queueInactiveSyncItem(item) {
  if (item.failed || isSyncItemReady(item)) return item;
  return { ...item, downloading: false, downloadPending: true };
}

function getSyncItemsSnapshot(client, ids, failed, activeId = "") {
  const active = String(activeId || "");
  return mergeFailedItems(ids.map((id) => {
    const item = getSyncItemStatus(client, id, failed);
    return active && String(id) !== active ? queueInactiveSyncItem(item) : item;
  }), failed);
}

function syncItemSignature(item) {
  if (!item) return "";
  return [
    item.id,
    item.progress,
    item.currentBytes,
    item.totalBytes,
    item.installed,
    item.needsUpdate,
    item.downloading,
    item.downloadPending,
    item.failed
  ].join(":");
}

function markStoppedItems(items, activeId = "") {
  return items.map((item) => {
    if (item.failed || isSyncItemReady(item)) return item;
    return {
      ...item,
      stopped: true,
      issue: item.id === activeId ? "Download stopped by user." : "Sync stopped before this item started.",
      downloading: false,
      downloadPending: false
    };
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeCliResult(name, result) {
  try {
    fs.writeFileSync(path.join(process.cwd(), name), JSON.stringify(result, null, 2));
  } catch {
    // Console output is still available in dev runs.
  }
}

async function probeSteam() {
  const client = await getSteamClient();
  return {
    ok: true,
    appId: client.utils.getAppId(),
    playerName: client.localplayer.getName(),
    dayzInstalled: client.apps.isAppInstalled(Number(DAYZ_APP_ID)),
    dayzOwned: client.apps.isSubscribedApp(Number(DAYZ_APP_ID)),
    subscribedCount: client.workshop.getSubscribedItems().length
  };
}

async function syncWorkshopItems(event, { itemIds = [], timeoutMs = 3 * 60 * 60 * 1000, stallMs = 90 * 1000, highPriority = true, syncPollMs = 2000 } = {}) {
  const ids = [...new Set(itemIds.map(String).filter((id) => /^\d+$/.test(id)))];
  if (!ids.length) return { ok: true, items: [] };

  const client = await getSteamClient();
  const sender = event?.sender;
  const pollMs = Math.max(500, Math.min(Number(syncPollMs) || 2000, 5000));
  const runId = ++workshopSyncRun;
  const cancelState = {
    runId,
    requested: false,
    activeId: "",
    subscribed: new Set()
  };
  workshopSyncCancel = cancelState;
  const finish = (result) => {
    if (workshopSyncCancel?.runId === runId) workshopSyncCancel = null;
    return result;
  };
  const startedAt = Date.now();
  let lastMovementAt = startedAt;
  let lastSignature = "";
  let activeId = "";
  const subscribed = [];
  const failed = [];

  const stopSync = () => {
    const stoppedItems = markStoppedItems(getSyncItemsSnapshot(client, ids, failed, activeId), activeId);
    emitSyncProgress(sender, { phase: "stopped", activeId: "", items: stoppedItems, failed });
    return finish({ ok: false, stopped: true, subscribed, failed, items: stoppedItems });
  };

  emitSyncProgress(sender, { phase: "starting", items: ids.map((id) => ({ id, progress: 0, downloadPending: true })) });

  const details = await getWorkshopFileDetails(ids);
  for (const id of ids) {
    const result = details.get(id)?.result;
    const message = workshopResultMessage(result);
    if (message) {
      failed.push({ id, message, unrecoverable: result === 9 });
    }
  }
  if (cancelState.requested) return stopSync();

  async function startWorkshopItem(id) {
    if (cancelState.requested) return;
    cancelState.activeId = id;
    const item = BigInt(id);
    const before = getSyncItemStatus(client, id, failed);
    if (!before.subscribed) {
      emitSyncProgress(sender, { phase: "subscribing", activeId: id, items: getSyncItemsSnapshot(client, ids, failed, id), failed });
      await client.workshop.subscribe(item);
      subscribed.push(id);
      cancelState.subscribed.add(id);
    }
    if (cancelState.requested) return;
    client.workshop.download(item, highPriority);
    lastMovementAt = Date.now();
    lastSignature = "";
  }

  let items = getSyncItemsSnapshot(client, ids, failed, activeId);
  if (failed.length === ids.length) {
    emitSyncProgress(sender, { phase: "failed", items, failed });
    return finish({ ok: false, subscribed, failed, items });
  }

  while (Date.now() - startedAt < timeoutMs) {
    if (cancelState.requested) return stopSync();

    let rawItems = mergeFailedItems(ids.map((id) => getSyncItemStatus(client, id, failed)), failed);
    const activeRawItem = rawItems.find((item) => item.id === activeId);
    if (activeId && (!activeRawItem || activeRawItem.failed || isSyncItemReady(activeRawItem))) {
      if (cancelState.activeId === activeId) cancelState.activeId = "";
      activeId = "";
      lastSignature = "";
      lastMovementAt = Date.now();
    }

    if (!activeId) {
      const nextItem = rawItems.find((item) => !item.failed && !isSyncItemReady(item));
      if (nextItem) {
        activeId = nextItem.id;
        try {
          await startWorkshopItem(activeId);
          if (cancelState.requested) return stopSync();
        } catch (error) {
          failed.push({ id: activeId, message: error.message });
          if (cancelState.activeId === activeId) cancelState.activeId = "";
          activeId = "";
        }
        rawItems = mergeFailedItems(ids.map((id) => getSyncItemStatus(client, id, failed)), failed);
      }
    }

    items = getSyncItemsSnapshot(client, ids, failed, activeId);
    const currentActiveItem = rawItems.find((item) => item.id === activeId);
    const signature = syncItemSignature(currentActiveItem);
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastMovementAt = Date.now();
    }

    const waitingOnSteam = Boolean(activeId && currentActiveItem && Date.now() - lastMovementAt > stallMs
      && !currentActiveItem.failed
      && !isSyncItemReady(currentActiveItem)
      && !currentActiveItem.downloading
      && (currentActiveItem.downloadPending || currentActiveItem.needsUpdate || currentActiveItem.subscribed));
    emitSyncProgress(sender, { phase: waitingOnSteam ? "waiting" : "downloading", activeId, items, failed, pollMs });

    const complete = rawItems.every((item) => item.failed || isSyncItemReady(item));
    if (complete) {
      emitSyncProgress(sender, { phase: failed.length ? "failed" : "complete", items, failed });
      return finish({ ok: failed.length === 0, subscribed, failed, items });
    }

    if (waitingOnSteam) {
      failed.push({ id: activeId, message: "Steam did not start this Workshop download. Open Steam downloads or the Workshop page, then retry sync." });
      if (cancelState.activeId === activeId) cancelState.activeId = "";
      activeId = "";
      items = getSyncItemsSnapshot(client, ids, failed, activeId);
      emitSyncProgress(sender, { phase: "stalled", activeId: "", items, failed });
      await delay(500);
      continue;
    }

    if (currentActiveItem && !currentActiveItem.failed && !isSyncItemReady(currentActiveItem) && !currentActiveItem.downloading) {
      try {
        client.workshop.download(BigInt(currentActiveItem.id), highPriority);
      } catch (error) {
        if (!failed.some((failedItem) => failedItem.id === currentActiveItem.id)) {
          failed.push({ id: currentActiveItem.id, message: error.message });
          if (cancelState.activeId === currentActiveItem.id) cancelState.activeId = "";
          activeId = "";
        }
      }
    }

    await delay(pollMs);
  }

  items = mergeFailedItems(items, failed);
  emitSyncProgress(sender, { phase: "timeout", items, failed });
  return finish({
    ok: false,
    subscribed,
    failed: [{ id: "timeout", message: "Timed out while waiting for Steam Workshop downloads." }, ...failed],
    items
  });
}

async function stopWorkshopSync() {
  const cancelState = workshopSyncCancel;
  if (!cancelState) {
    return { ok: false, stopped: false, message: "No Workshop sync is running." };
  }

  cancelState.requested = true;
  const unsubscribed = [];
  const unsubscribeErrors = [];

  if (cancelState.subscribed.size) {
    try {
      const client = await getSteamClient();
      for (const id of cancelState.subscribed) {
        try {
          const item = getWorkshopItemStatus(client, id);
          if (!isSyncItemReady(item)) {
            await client.workshop.unsubscribe(BigInt(id));
            unsubscribed.push(id);
          }
        } catch (error) {
          unsubscribeErrors.push({ id, message: error.message });
        }
      }
    } catch (error) {
      unsubscribeErrors.push({ id: cancelState.activeId || "steam", message: error.message });
    }
  }

  return {
    ok: true,
    stopped: true,
    activeId: cancelState.activeId,
    unsubscribed,
    unsubscribeErrors
  };
}

function readMetaName(modFolder) {
  const metaPath = path.join(modFolder, "meta.cpp");
  if (!fs.existsSync(metaPath)) return "";
  try {
    const meta = fs.readFileSync(metaPath, "utf8");
    return meta.match(/name\s*=\s*"([^"]+)"/i)?.[1] ?? "";
  } catch {
    return "";
  }
}

function readCString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end === -1) return ["", buffer.length];
  return [buffer.toString("utf8", offset, end), end + 1];
}

function parseA2sInfo(buffer) {
  if (buffer.length < 6 || buffer.readUInt32LE(0) !== 0xffffffff || buffer[4] !== 0x49) return null;
  let offset = 6;
  let name;
  let map;
  let folder;
  let game;
  [name, offset] = readCString(buffer, offset);
  [map, offset] = readCString(buffer, offset);
  [folder, offset] = readCString(buffer, offset);
  [game] = readCString(buffer, offset);
  return { name, map: normalizeMapName(map), folder, game };
}

function isDayzA2sInfo(info) {
  if (!info) return false;
  const folder = String(info.folder || "").toLowerCase();
  const game = String(info.game || "").toLowerCase();
  return folder === "dayz" || game.includes("dayz");
}

function queryServerInfo(ip, queryPort, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let finished = false;
    let timeout = null;
    const startedAt = Date.now();
    const base = Buffer.concat([
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
      Buffer.from("Source Engine Query\0")
    ]);

    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // ignore close races
      }
      resolve(result);
    };

    const send = (challenge) => {
      const message = challenge ? Buffer.concat([base, challenge]) : base;
      try {
        socket.send(message, queryPort, ip, (error) => {
          if (error) finish(null);
        });
      } catch {
        finish(null);
      }
    };

    socket.on("message", (buffer) => {
      if (buffer.length >= 9 && buffer.readUInt32LE(0) === 0xffffffff && buffer[4] === 0x41) {
        send(buffer.subarray(5, 9));
        return;
      }
      const info = parseA2sInfo(buffer);
      finish(info ? { ...info, pingMs: Math.max(1, Date.now() - startedAt) } : null);
    });
    socket.on("error", () => finish(null));
    send();
    timeout = setTimeout(() => finish(null), timeoutMs);
  });
}

function applyServerQueryInfo(server, info, queryPort) {
  const next = {
    ...server,
    pingMs: Number(info.pingMs),
    pingStatus: pingStatusFromMs(info.pingMs),
    lastPingAt: new Date().toISOString(),
    queryPort
  };

  if (server.mapSource !== "source" && info.map && info.map !== "Unknown") {
    next.map = info.map;
    next.mapSource = "server-query";
  }

  return next;
}

function markPingUnavailable(server) {
  return {
    ...server,
    pingMs: null,
    pingStatus: "unreachable",
    lastPingAt: new Date().toISOString()
  };
}

function queryPortCandidates(server) {
  return [
    server.details?.queryPort,
    server.details?.steamQueryPort,
    server.details?.portQuery,
    server.queryPort,
    server.port + 1,
    27016,
    27017,
    27018,
    27015,
    server.port
  ]
    .map(Number)
    .filter((port, index, ports) => Number.isInteger(port) && port > 0 && port < 65536 && ports.indexOf(port) === index);
}

async function enrichServerMap(server, options = {}) {
  if (!server.ip) return server;

  const candidates = queryPortCandidates(server).slice(0, options.maxCandidates ?? (server.mapSource === "source" ? 1 : Infinity));
  const timeoutMs = options.timeoutMs ?? 900;
  for (const queryPort of candidates) {
    const info = await queryServerInfo(server.ip, queryPort, timeoutMs);
    if (isDayzA2sInfo(info)) {
      return applyServerQueryInfo(server, info, queryPort);
    }
  }
  const inferred = inferMapFromText(`${server.name} ${server.modNames?.join(" ") || ""}`);
  const mapped = inferred && server.mapSource !== "source" ? { ...server, map: inferred, mapSource: "inferred" } : server;
  return markPingUnavailable(mapped);
}

async function enrichMaps(servers, concurrency = 20) {
  const queue = [...servers];
  const results = [];
  async function worker() {
    while (queue.length) {
      const server = queue.shift();
      results.push(await enrichServerMap(server));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, servers.length) }, worker));
  const byId = new Map(results.map((server) => [server.id, server]));
  return servers.map((server) => byId.get(server.id) || server);
}

async function fetchServers(options = {}) {
  const catalog = await fetchDzsaServerCatalog();
  return selectDzsaServers(catalog, {
    ...options,
    limit: Math.min(Number(options.limit || 500), 1000)
  });
}

async function refreshServer(server = {}) {
  return refreshServerDetails(server, fetchDzsaServerCatalog, (current) =>
    enrichServerMap(current, { maxCandidates: Infinity, timeoutMs: 1400 }));
}

function emitDiscovery(sender, payload) {
  sender?.send("servers:discovery", payload);
}

async function discoverServers(event, options = {}) {
  const runId = ++serverDiscoveryRun;
  const sender = event?.sender;
  const limit = Math.min(Number(options.limit || 2000), 5000);
  const pageSize = Math.min(Math.max(250, Number(options.pageSize || 250)), 500);
  let totalFetched = 0;
  let page = 0;

  emitDiscovery(sender, { runId, phase: "started", limit, totalFetched: 0, batch: [] });

  try {
    const catalog = await fetchDzsaServerCatalog();
    const selected = selectDzsaServers(catalog, { ...options, limit });

    for (let offset = 0; offset < selected.length && runId === serverDiscoveryRun; offset += pageSize) {
      const batch = selected.slice(offset, offset + pageSize);
      page += 1;
      totalFetched += batch.length;
      emitDiscovery(sender, {
        runId,
        phase: "page",
        page,
        totalFetched,
        limit,
        sourceTotal: catalog.length,
        batch
      });
      await delay(0);
    }

    if (runId === serverDiscoveryRun) {
      emitDiscovery(sender, { runId, phase: "complete", totalFetched, limit, sourceTotal: catalog.length, batch: [] });

      const pingCandidates = selected.slice(0, 200);
      void enrichMaps(pingCandidates, 24).then((mappedBatch) => {
        if (runId !== serverDiscoveryRun) return;
        emitDiscovery(sender, {
          runId,
          phase: "mapped",
          totalFetched,
          limit,
          sourceTotal: catalog.length,
          batch: mappedBatch
        });
        emitDiscovery(sender, { runId, phase: "complete", totalFetched, limit, sourceTotal: catalog.length, batch: [] });
      }).catch(() => {
        // The feed data remains usable when direct A2S ping checks are blocked.
      });
    }
  } catch (error) {
    if (runId === serverDiscoveryRun) {
      emitDiscovery(sender, { runId, phase: "error", message: error.message, totalFetched, limit, batch: [] });
    }
    return { ok: false, runId, totalFetched, limit, message: error.message };
  }

  return { ok: runId === serverDiscoveryRun, runId, totalFetched, limit };
}

function getState() {
  return migrateServerState(readJson(settingsPath(), {
    favorites: [],
    recents: [],
    playerName: os.userInfo().username || "Survivor",
    launchExtraArgs: "",
    preferBattlEye: true
  }));
}

function saveSettings(patch) {
  const next = { ...getState(), ...patch };
  writeJson(settingsPath(), next);
  return next;
}

function isAllowedExternalUrl(value) {
  return isAllowedExternalUrlCore(value, {
    repositoryUrl: getRepositoryUrl(),
    fundingUrl: getFundingUrl()
  });
}

async function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!isAllowedExternalUrl(target)) {
    throw new Error("This external URL is not allowed.");
  }
  if (/^steam:\/\//i.test(target)) {
    await startSteamIfNeeded({ waitMs: 5000 });
  }
  await shell.openExternal(target);
  return { ok: true, url: target };
}

async function openSteamUrl(url) {
  return openExternalUrl(url);
}

async function launchDayz({ server, playerName, modPaths = [], extraArgs = "", preferBattlEye = true }) {
  const paths = getKnownPaths();
  const exe = preferBattlEye ? paths.dayzExe || paths.dayzRawExe : paths.dayzRawExe || paths.dayzExe;
  const steamStatus = await startSteamIfNeeded({ waitMs: 12000 });
  if (!exe) {
    await openSteamUrl(`steam://connect/${server.ip}:${server.port}`);
    return {
      ok: true,
      mode: "steam-connect",
      steamStatus,
      message: steamStatus.started
        ? "Steam was started and the connect URL was opened."
        : "DayZ executable was not found; opened Steam connect URL."
    };
  }
  await getSteamClient({ waitReadyMs: 60000 });

  const args = [];
  if (server?.ip) args.push(`-connect=${server.ip}`);
  if (server?.port) args.push(`-port=${server.port}`);
  if (playerName) args.push(`-name=${playerName}`);
  if (modPaths.length) args.push(`-mod=${modPaths.join(";")}`);
  if (extraArgs?.trim()) args.push(...extraArgs.match(/(?:[^\s"]+|"[^"]*")+/g).map((arg) => arg.replace(/^"|"$/g, "")));

  const child = execFile(exe, args, { cwd: paths.dayzPath, windowsHide: false }, () => {});
  child.unref();

  const state = getState();
  const recents = [server, ...(state.recents || []).filter((item) => item.id !== server.id)].slice(0, 20);
  saveSettings({ recents, playerName, launchExtraArgs: extraArgs, preferBattlEye });

  return { ok: true, mode: "direct-exe", exe, args, steamStatus };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1680,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#101315",
    title: "Ranger for DayZ",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev
    }
  });
  win.removeMenu();
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.show();
    win.webContents.invalidate();
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  if (smokeTest || rendererSmokeTest) {
    win.webContents.once("did-finish-load", () => {
      if (!rendererSmokeTest) {
        setTimeout(() => app.quit(), 600);
        return;
      }

      setTimeout(async () => {
        try {
          const result = await win.webContents.executeJavaScript(
            "({ title: document.title, text: document.body.innerText.slice(0, 500), hasRootContent: Boolean(document.querySelector('#root')?.innerText.trim()) })"
          );
          writeCliResult("renderer-smoke-test-result.json", result);
          process.exitCode = result.hasRootContent ? 0 : 1;
        } catch (error) {
          writeCliResult("renderer-smoke-test-result.json", { ok: false, message: error.message });
          process.exitCode = 1;
        } finally {
          app.quit();
        }
      }, 1500);
    });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setupAutoUpdater();

  ipcMain.handle("app:info", () => getAppInfo());
  ipcMain.handle("app:open-external", (_event, url) => openExternalUrl(url));
  ipcMain.handle("app:check-updates", () => checkForUpdates());
  ipcMain.handle("app:install-update", () => installDownloadedUpdate());
  ipcMain.handle("state:get", () => getState());
  ipcMain.handle("state:save", (_event, patch) => saveSettings(patch));
  ipcMain.handle("paths:detect", () => getKnownPaths());
  ipcMain.handle("mods:scan", (_event, overrides) => scanLocalMods(overrides));
  ipcMain.handle("mods:delete", (_event, payload) => deleteLocalMod(payload));
  ipcMain.handle("mods:delete-many", (_event, payload) => deleteLocalMods(payload));
  ipcMain.handle("servers:list", (_event, options) => fetchServers(options));
  ipcMain.handle("servers:discover", (event, options) => discoverServers(event, options));
  ipcMain.handle("servers:refresh-one", (_event, server) => refreshServer(server));
  ipcMain.handle("steam:open", (_event, url) => openSteamUrl(url));
  ipcMain.handle("steam:probe", () => probeSteam());
  ipcMain.handle("steam:sync-workshop", (event, payload) => syncWorkshopItems(event, payload));
  ipcMain.handle("steam:stop-workshop-sync", () => stopWorkshopSync());
  ipcMain.handle("dayz:launch", (_event, payload) => launchDayz(payload));

  if (steamProbeTest || steamSyncTestArg || serverFetchTest) {
    const command = steamSyncTestArg
      ? syncWorkshopItems(null, { itemIds: steamSyncTestArg.split("=")[1].split(","), timeoutMs: 30000, highPriority: false })
      : serverFetchTest
        ? fetchServers({ limit: 500 })
      : probeSteam();
    command
      .then((result) => {
        const fileName = steamSyncTestArg
          ? "steam-sync-test-result.json"
          : serverFetchTest
            ? "server-fetch-test-result.json"
            : "steam-probe-test-result.json";
        writeCliResult(fileName, result);
        console.log(JSON.stringify(result, null, 2));
      })
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
        process.exitCode = 1;
      })
      .finally(() => app.quit());
    return;
  }

  if (!smokeTest && !rendererSmokeTest) {
    getSteamClient({ waitReadyMs: 60000 }).catch(() => {});
  }

  createWindow();

  if (!smokeTest && !rendererSmokeTest && updatesCanRun()) {
    stopBackgroundUpdateChecks = startBackgroundUpdateChecks(checkForUpdates);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopBackgroundUpdateChecks?.();
});
