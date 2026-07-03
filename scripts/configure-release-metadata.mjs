import fs from "node:fs";

const slug = process.argv[2] || process.env.GITHUB_REPOSITORY || "";
const [owner, repo] = slug.split("/");

if (!owner || !repo) {
  throw new Error("Expected a GitHub repository slug like OWNER/ranger-for-dayz.");
}

const packagePath = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const projectUrl = `https://github.com/${owner}/${repo}`;

packageJson.homepage = `${projectUrl}#readme`;
packageJson.repository = {
  type: "git",
  url: `${projectUrl}.git`
};
packageJson.build = {
  ...packageJson.build,
  publish: [
    {
      provider: "github",
      owner,
      repo,
      releaseType: "draft"
    }
  ]
};

fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Configured release metadata for ${owner}/${repo}.`);
