import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function validateReleaseContext({
  version,
  ref = "",
  refName = "",
  actor = "",
  allowedActor = "RayDeras84"
} = {}) {
  if (!version) throw new Error("package.json version is required.");

  if (actor && actor !== allowedActor) {
    throw new Error(`Only ${allowedActor} may run the release workflow. Current actor: ${actor}.`);
  }

  if (ref && !ref.startsWith("refs/tags/")) {
    throw new Error(`Release workflow must run from a version tag, not ${ref}.`);
  }

  const tag = refName || (ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : "");
  if (!tag) throw new Error("Release tag is required.");
  if (!/^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(tag)) {
    throw new Error(`Release tag must look like v0.0.0. Received: ${tag}.`);
  }

  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag} does not match package.json version ${version}. Expected ${expectedTag}.`);
  }

  return { tag, version, actor: actor || "" };
}

function readPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validateReleaseContext({
    version: readPackageVersion(),
    ref: process.env.GITHUB_REF || "",
    refName: process.env.GITHUB_REF_NAME || process.argv[2] || "",
    actor: process.env.GITHUB_ACTOR || "",
    allowedActor: process.env.RFDZ_RELEASE_ACTOR || "RayDeras84"
  });
  console.log(`Release context verified for ${result.tag}.`);
}
