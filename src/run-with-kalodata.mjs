import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = "/Users/dadski/Projects/dropship-codex";
const DEBUG_DIR = path.join(ROOT, "output", "debug");

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { env: extraEnv, ...spawnOptions } = options;

    const child = spawn(cmd, args, {
      stdio: options.stdio ?? "inherit",
      shell: false,
      ...spawnOptions,
      env: {
        ...process.env,
        ...(extraEnv || {}),
      },
    });

    child.on("error", reject);

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function createRunLogger() {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const logPath = path.join(DEBUG_DIR, `kalodata-run-${timestampForFile()}.log`);
  const stream = fs.createWriteStream(logPath, { flags: "a" });

  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);

  const write = (level, args) => {
    const line = args.map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(" ");

    stream.write(`[${new Date().toISOString()}] [${level}] ${line}\n`);
  };

  console.log = (...args) => {
    originalLog(...args);
    write("info", args);
  };

  console.error = (...args) => {
    originalError(...args);
    write("error", args);
  };

  return {
    logPath,
    writeRaw: (level, chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        stream.write(`[${new Date().toISOString()}] [${level}] ${line}\n`);
      }
    },
    close: () => new Promise((resolve) => stream.end(resolve)),
  };
}

function runLogged(cmd, args, logger, options = {}) {
  return new Promise((resolve, reject) => {
    const { env: extraEnv, ...spawnOptions } = options;

    const child = spawn(cmd, args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
      ...spawnOptions,
      env: {
        ...process.env,
        ...(extraEnv || {}),
      },
    });

    child.stdout?.on("data", (chunk) => {
      output.write(chunk);
      logger.writeRaw("stdout", chunk);
    });

    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
      logger.writeRaw("stderr", chunk);
    });

    child.on("error", reject);

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function parseRunnerArgs(args) {
  const env = {};

  for (const arg of args) {
    const pages = arg.match(/^pages:(\d+)$/i);
    if (pages) {
      env.KALODATA_MAX_PAGES = pages[1];
      continue;
    }

    const startPage = arg.match(/^(?:page|start):(\d+)$/i);
    if (startPage) {
      env.KALODATA_START_PAGE = startPage[1];
      continue;
    }

    const products = arg.match(/^products:(\d+)$/i);
    if (products) {
      env.KALODATA_MAX_PRODUCTS = products[1];
      continue;
    }

    const report = arg.match(/^(?:report|limit|selected):(\d+)$/i);
    if (report) {
      env.REPORT_PRODUCT_LIMIT = report[1];
    }
  }

  return env;
}

async function waitForEnter(message) {
  const rl = readline.createInterface({ input, output });
  await rl.question(`\n${message}\nPress Enter here when Kalodata product table is visible... `);
  rl.close();
}

await mkdir(DEBUG_DIR, { recursive: true });
const logger = createRunLogger();

try {
  console.log(`[runner] Saving run log to ${logger.logPath}`);

  const runEnv = parseRunnerArgs(process.argv.slice(2));

  if (runEnv.KALODATA_MAX_PAGES) {
    console.log(`[runner] Kalodata page limit set to ${runEnv.KALODATA_MAX_PAGES}.`);
  }

  if (runEnv.KALODATA_START_PAGE) {
    console.log(`[runner] Kalodata start page set to ${runEnv.KALODATA_START_PAGE}.`);
  }

  if (runEnv.KALODATA_MAX_PRODUCTS) {
    console.log(`[runner] Kalodata product limit set to ${runEnv.KALODATA_MAX_PRODUCTS}.`);
  }

  if (runEnv.REPORT_PRODUCT_LIMIT) {
    console.log(`[runner] Report product limit set to ${runEnv.REPORT_PRODUCT_LIMIT}.`);
  }

  console.log("[runner] Opening normal Chrome for Kalodata...");
  await runLogged("npm", ["run", "kalodata:chrome"], logger);

  await waitForEnter(
    "Complete Kalodata Cloudflare/login manually in the Chrome window."
  );

  console.log("[runner] Starting research...");
  await runLogged("npm", ["run", "research"], logger, { env: runEnv });
} finally {
  await logger.close();
}
