import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] || "nsis";
const includeUpdateConfig = process.argv.includes("--update-config") || process.env.RFDZ_INCLUDE_UPDATE_CONFIG === "1";
const allowedTargets = new Set(["nsis", "portable"]);

if (!allowedTargets.has(target)) {
  throw new Error(`Unsupported package target "${target}". Expected one of: ${[...allowedTargets].join(", ")}.`);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = path.join(os.tmpdir(), "ranger-for-dayz-release");
const outputDir = path.resolve(process.env.RFDZ_RELEASE_DIR || defaultOutput);
const packagePath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

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

function githubSlugFromPackage() {
  const candidates = [
    process.env.RFDZ_UPDATE_REPO,
    process.env.GITHUB_REPOSITORY,
    packageJson.homepage,
    packageJson.repository?.url
  ];

  for (const candidate of candidates) {
    const match = String(candidate || "").match(/github\.com[/:]([^/\s]+)\/([^/\s#.]+)(?:\.git)?/i)
      || String(candidate || "").match(/^([^/\s]+)\/([^/\s]+)$/);
    if (match) return [match[1], match[2].replace(/\.git$/i, "")];
  }

  throw new Error("Could not infer GitHub repository. Set RFDZ_UPDATE_REPO=OWNER/repo.");
}

function writeBuilderConfig() {
  const configPath = path.join(repoRoot, `.electron-builder-local-${process.pid}.json`);
  const config = {
    ...packageJson.build,
    directories: {
      ...(packageJson.build?.directories || {}),
      output: outputDir
    }
  };

  if (includeUpdateConfig) {
    const [owner, repo] = githubSlugFromPackage();
    config.publish = [
      {
        provider: "github",
        owner,
        repo,
        private: true
      }
    ];
    console.log(`Including updater metadata for private GitHub repo ${owner}/${repo}.`);
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

if (isUnsafeOutputDir(outputDir)) {
  throw new Error(`Refusing to use unsafe package output directory: ${outputDir}`);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

run("npm.cmd", ["run", "prepare-icon"]);
run("npm.cmd", ["run", "build"]);
const builderConfigPath = writeBuilderConfig();

try {
  run("npx.cmd", [
    "electron-builder",
    "--win",
    target,
    "--config",
    builderConfigPath,
    "--publish",
    "never"
  ]);
} finally {
  fs.rmSync(builderConfigPath, { force: true });
}

console.log(`\nRanger for DayZ ${target} package output:`);
console.log(outputDir);
