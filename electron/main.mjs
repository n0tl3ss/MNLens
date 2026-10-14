import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let server;
let window;
let logFile;

async function main() {
  process.env.NODE_ENV = "production";
  process.env.MNLENS_HOST = "127.0.0.1";
  process.env.MNLENS_CACHE_DIR = join(app.getPath("userData"), ".pra-cache");
  process.env.MNLENS_WORK_DIR = process.env.MNLENS_CACHE_DIR;
  logFile = join(app.getPath("userData"), "mnlens-electron.log");
  mkdirSync(process.env.MNLENS_CACHE_DIR, { recursive: true });
  log("Starting MNLens desktop app.");
  const appRoot = app.getAppPath();
  const logoUrl = logoDataUrl(join(appRoot, "dist", "client", "mnlens-logo.png"));

  window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 980,
    minHeight: 720,
    title: "MNLens",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1e21" : "#e7e8e3",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.on("closed", () => {
    window = undefined;
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (openLocalArtifact(target)) return { action: "deny" };
    void shell.openExternal(target);
    return { action: "deny" };
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer process gone: ${details.reason} ${details.exitCode}`);
  });
  window.webContents.on("did-fail-load", (_event, code, description, failedUrl) => {
    log(`Window failed to load ${failedUrl}: ${code} ${description}`);
  });
  await window.loadURL(startupSplashUrl("Starting local review workspace", logoUrl));

  const { createApp } = await import(pathToFileURL(join(appRoot, "dist", "server", "server", "app.js")).href);
  const expressApp = await createApp({ serveClient: true, recoverJobs: true });
  const port = await listenOnAvailablePort(expressApp, Number(process.env.PORT ?? 4321));
  const url = `http://127.0.0.1:${port}`;
  log(`MNLens server listening on ${url}`);
  await window.loadURL(url);
}

function startupSplashUrl(message, logoUrl) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    <title>MNLens</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --bg: #e7e8e3;
        --ink: #20292d;
        --muted: #5f6a6e;
        --track: #d3d5cd;
        --bar: #2a7a93;
        background: var(--bg);
        color: var(--ink);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #1b1e21;
          --ink: #e8ebec;
          --muted: #9aa4a9;
          --track: #30363b;
          --bar: #6fb3cc;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: var(--bg);
      }
      main {
        width: min(420px, calc(100vw - 48px));
        display: grid;
        justify-items: center;
        gap: 18px;
        text-align: center;
      }
      .mark {
        width: 96px;
        height: 96px;
        display: grid;
        place-items: center;
      }
      .mark img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      h1 {
        margin: 0;
        font-size: 22px;
        letter-spacing: 0;
      }
      p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      .bar {
        width: 100%;
        height: 6px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--track);
      }
      .bar::before {
        content: "";
        display: block;
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: var(--bar);
        animation: load 1.35s ease-in-out infinite;
      }
      @keyframes load {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(250%); }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true"><img src="${escapeHtml(logoUrl)}" alt="" /></div>
      <div>
        <h1>MNLens</h1>
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="bar" aria-label="Loading"></div>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function openLocalArtifact(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return false;
  if (!parsed.pathname.startsWith("/api/artifacts")) return false;

  const artifactPath = artifactPathFromUrl(parsed);
  if (!artifactPath) {
    log(`Could not resolve artifact URL: ${target}`);
    return true;
  }
  if (!existsSync(artifactPath)) {
    log(`Artifact does not exist: ${artifactPath}`);
    return true;
  }

  const isHtml = artifactPath.toLowerCase().endsWith(".html") || artifactPath.toLowerCase().endsWith(".htm");
  const openTarget = parsed.hash || isHtml ? `${pathToFileURL(artifactPath).href}${parsed.hash}` : artifactPath;
  const openPromise = parsed.hash || isHtml
    ? shell.openExternal(openTarget)
    : shell.openPath(artifactPath);
  void Promise.resolve(openPromise).then((error) => {
    if (error) log(`Could not open artifact ${artifactPath}: ${error}`);
  });
  return true;
}

function artifactPathFromUrl(parsed) {
  const directPath = parsed.searchParams.get("path");
  if (directPath) {
    const cacheRoot = resolve(process.env.MNLENS_CACHE_DIR);
    const candidate = resolve(directPath);
    return candidate === cacheRoot || candidate.startsWith(`${cacheRoot}/`) ? candidate : undefined;
  }

  const match = /^\/api\/artifacts\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
  if (!match) return undefined;

  const jobId = decodeURIComponent(match[1]);
  const fileName = decodeURIComponent(match[2]);
  if (!/^[a-zA-Z0-9._-]+$/.test(jobId) || basename(fileName) !== fileName) return undefined;

  const root = resolve(process.env.MNLENS_CACHE_DIR, "artifacts", jobId);
  const candidate = resolve(root, fileName);
  return candidate.startsWith(`${root}/`) ? candidate : undefined;
}

function logoDataUrl(path) {
  try {
    return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
  } catch (error) {
    log(`Could not load splash logo from ${path}: ${error?.message || error}`);
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function listenOnAvailablePort(expressApp, preferredPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const candidate = createServer(expressApp);
      candidate.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < preferredPort + 50) {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      candidate.listen(port, "127.0.0.1", () => {
        server = candidate;
        resolve(port);
      });
    };
    tryPort(preferredPort);
  });
}

app.whenReady().then(main).catch((error) => {
  log(`Fatal startup error: ${error?.stack || error}`);
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  server?.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  server?.close();
});

process.on("uncaughtException", (error) => {
  log(`Uncaught exception: ${error.stack || error.message}`);
});

process.on("unhandledRejection", (error) => {
  log(`Unhandled rejection: ${error instanceof Error ? error.stack : String(error)}`);
});

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    if (logFile) appendFileSync(logFile, line);
  } catch {
    // Logging must not prevent startup.
  }
  console.log(line.trim());
}
