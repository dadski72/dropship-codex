import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = "/Users/dadski/Projects/dropship-codex";
const PROFILE = path.join(ROOT, "profiles/kalodata-cdp");
const CDP_URL = "http://127.0.0.1:9222";
const KALODATA_URL = "https://www.kalodata.com/product";

// Default: open in background so it does not steal focus.
// To force foreground once: KALODATA_FOCUS=1 npm run kalodata:chrome
const openInBackground = process.env.KALODATA_FOCUS !== "1";

async function isCdpAlreadyRunning() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (await isCdpAlreadyRunning()) {
    console.log("Kalodata Chrome/CDP is already running on port 9222.");
    console.log("Skipping browser spawn to avoid stealing focus.");
    return;
  }

  const args = [
    ...(openInBackground ? ["-g"] : []),
    "-na",
    "Google Chrome",
    "--args",
    "--remote-debugging-port=9222",
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    KALODATA_URL,
  ];

  const child = spawn("open", args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  console.log(
    openInBackground
      ? "Opened normal Google Chrome for Kalodata in the background."
      : "Opened normal Google Chrome for Kalodata in the foreground."
  );

  console.log("Complete Cloudflare/login manually, then continue the workflow.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
