import { spawn, execFile } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";

const ROOT = "/Users/dadski/Projects/dropship-codex";

const SITES = {
  kalodata: {
    url: "https://www.kalodata.com/product",
    profile: path.join(ROOT, "profiles/kalodata"),
  },
  facebook: {
    url: "https://www.facebook.com/ads/library",
    profile: path.join(ROOT, "profiles/facebook"),
  },
  aliexpress: {
    url: "https://www.aliexpress.us",
    profile: path.join(ROOT, "profiles/aliexpress"),
  },
  tiktok: {
    url: "https://www.tiktok.com",
    profile: path.join(ROOT, "profiles/tiktok"),
  },
};

async function waitForEnter(message) {
  const rl = readline.createInterface({ input, output });
  await rl.question(`\n${message}\nPress Enter in this terminal when done... `);
  rl.close();
}


function closeProfileChrome(profilePath) {
  return new Promise((resolve) => {
    execFile("pkill", ["-f", profilePath], () => {
      setTimeout(resolve, 1000);
    });
  });
}
function openNormalChrome(site) {
  const args = [
    "-na",
    "Google Chrome",
    "--args",
    `--user-data-dir=${site.profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    site.url,
  ];

  const child = spawn("open", args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

async function main() {
  const siteName = process.argv[2];

  if (!siteName || !SITES[siteName]) {
    console.error(`Usage: node src/login.mjs <${Object.keys(SITES).join("|")}>`);
    process.exit(1);
  }

  const site = SITES[siteName];

  console.log(`\nOpening ${siteName} in normal Chrome...`);
  console.log(`URL: ${site.url}`);
  console.log(`Profile: ${site.profile}`);
  console.log("Do NOT sign in to Chrome Sync. Only sign in to the website itself.");

  openNormalChrome(site);

  await waitForEnter(
    `${siteName}: finish any login/security check manually in the opened Chrome window.`
  );

  console.log(`${siteName}: closing Chrome profile window...`);
  await closeProfileChrome(site.profile);

  console.log(`${siteName}: login/profile check done.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
