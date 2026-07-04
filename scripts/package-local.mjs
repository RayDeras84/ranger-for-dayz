import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] || "nsis";
const allowedTargets = new Set(["nsis", "portable"]);

if (!allowedTargets.has(target)) {
  throw new Error(`Unsupported package target "${target}". Expected one of: ${[...allowedTargets].join(", ")}.`);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = path.join(os.tmpdir(), "ranger-for-dayz-release");
const outputDir = path.resolve(process.env.RFDZ_RELEASE_DIR || defaultOutput);

function isUnsafeOutputDir(value) {
  const parsed = path.parse(value);
  const normalized = path.normalize(value);
  return normalized === parsed.root
    || normalized === path.normalize(os.homedir())
    || normalized === path.normalize(repoRoot)
    || normalized.length < parsed.root.length + 12;
}

function run(command, args) {
  const spawnCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
  const spawnArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", [command, ...args].map(quoteCmdArg).join(" ")]
    : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function quoteCmdArg(value) {
  const text = String(value);
  if (text.includes("\"")) {
    throw new Error(`Cannot safely pass argument containing a quote to cmd.exe: ${text}`);
  }
  return /\s/.test(text) ? `"${text}"` : text;
}

if (isUnsafeOutputDir(outputDir)) {
  throw new Error(`Refusing to use unsafe package output directory: ${outputDir}`);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

run("npm.cmd", ["run", "prepare-icon"]);
run("npm.cmd", ["run", "build"]);
run("npx.cmd", [
  "electron-builder",
  "--win",
  target,
  `-c.directories.output=${outputDir}`
]);

console.log(`\nRanger for DayZ ${target} package output:`);
console.log(outputDir);
