"use strict";

/**
 * LifeOS for Windows.
 *
 * Two ways to run, chosen in Settings:
 *  - On this computer (default): the LifeOS server ships inside the app and
 *    runs on 127.0.0.1, its data in the person's own application-data folder,
 *    their AI keys encrypted by Windows. Nothing needs the internet but the
 *    AI models themselves.
 *  - Online: the window opens the person's LifeOS deployment.
 *
 * The window is a locked-down browser: no Node, sandboxed, isolated; it may
 * only show LifeOS (links elsewhere open in the browser); it may use the
 * microphone and notifications for LifeOS only. A tray icon keeps reminders
 * alive when the window is closed, and Ctrl+Shift+Space captures a thought
 * from anywhere.
 */

const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, safeStorage, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { applyUpdate, envFor, normalize, publicConfig } = require("./lib/config.cjs");
const { isAllowedNavigation, isExternalSafe, originOf } = require("./lib/navigation.cjs");

const APP_ID = "ai.lifeos.desktop";
/** The one person on this computer's LifeOS, for the local server's session. */
const LOCAL_IDENTITY = "me@lifeos.local";
const SHORTCUT = "CommandOrControl+Shift+Space";

const fr = () => app.getLocale().toLowerCase().startsWith("fr");
const T = {
  open: () => (fr() ? "Ouvrir LifeOS" : "Open LifeOS"),
  capture: () => (fr() ? "Capture rapide" : "Quick capture"),
  settings: () => (fr() ? "Paramètres…" : "Settings…"),
  reload: () => (fr() ? "Recharger" : "Reload"),
  logs: () => (fr() ? "Ouvrir le dossier des journaux" : "Open the logs folder"),
  quit: () => (fr() ? "Quitter LifeOS" : "Quit LifeOS"),
  stillRunning: () => (fr() ? "LifeOS reste ouvert dans la barre des tâches, pour vos rappels." : "LifeOS keeps running in the tray, for your reminders."),
  serverFailed: () => (fr() ? "Le serveur LifeOS local n'a pas pu démarrer." : "The local LifeOS server could not start."),
  serverStopped: () => (fr() ? "Le serveur LifeOS local s'est arrêté." : "The local LifeOS server stopped."),
  restart: () => (fr() ? "Redémarrer" : "Restart"),
  close: () => (fr() ? "Fermer" : "Close"),
  seeLogs: () => (fr() ? "Le détail est dans le journal :" : "Details are in the log:"),
  noCloud: () => (fr() ? "Aucune adresse LifeOS en ligne n'est réglée : LifeOS s'ouvre sur cet ordinateur." : "No online LifeOS address is set: LifeOS opens on this computer."),
};

// A separate profile (settings, data, logs) — for testing, or a second person on the same Windows account.
if (process.env.LIFEOS_PROFILE_DIR) app.setPath("userData", path.resolve(process.env.LIFEOS_PROFILE_DIR));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  main();
}

function main() {
  const token = crypto.randomBytes(32).toString("hex");
  const configFile = () => path.join(app.getPath("userData"), "settings.json");
  const logsDir = () => path.join(app.getPath("userData"), "logs");
  const iconPath = path.join(__dirname, "assets", "icon.png");

  /** @type {BrowserWindow | null} */ let win = null;
  /** @type {BrowserWindow | null} */ let settingsWin = null;
  /** @type {Tray | null} */ let tray = null;
  /** @type {import("node:child_process").ChildProcess | null} */ let server = null;
  let origin = null;
  let allowed = [];
  let quitting = false;
  let toldAboutTray = false;

  /* ── Settings ──────────────────────────────────────────────────────── */

  function readConfig() {
    try {
      return normalize(JSON.parse(fs.readFileSync(configFile(), "utf8")));
    } catch {
      return normalize({});
    }
  }

  function writeConfig(config) {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    const tmp = `${configFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, configFile());
  }

  const encrypt = (plain) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("encryption-unavailable");
    return safeStorage.encryptString(plain).toString("base64");
  };
  const decrypt = (cipher) => safeStorage.decryptString(Buffer.from(cipher, "base64"));

  /* ── The local server ──────────────────────────────────────────────── */

  const serverDir = () => (app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "build", "server"));

  function freePort() {
    return new Promise((resolve, reject) => {
      const s = net.createServer();
      s.unref();
      s.on("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });
  }

  function logStream() {
    fs.mkdirSync(logsDir(), { recursive: true });
    const file = path.join(logsDir(), "server.log");
    try {
      if (fs.statSync(file).size > 5_000_000) fs.renameSync(file, `${file}.1`);
    } catch {
      /* first run */
    }
    return fs.createWriteStream(file, { flags: "a" });
  }

  async function startServer(config) {
    const port = await freePort();
    // Only what the server needs: the person's environment carries other
    // programs' secrets, and a stray Supabase variable would change the mode.
    const pick = ["SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PATH", "Path", "HOMEDRIVE", "HOMEPATH", "COMPUTERNAME", "NUMBER_OF_PROCESSORS"];
    const env = Object.fromEntries(pick.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    Object.assign(env, envFor(config, decrypt), {
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      LIFEOS_DATA_DIR: path.join(app.getPath("userData"), "data"),
      LIFEOS_DESKTOP_TOKEN: token,
    });
    const log = logStream();
    log.write(`\n--- ${new Date().toISOString()} start on ${port}\n`);
    const child = spawn(process.execPath, [path.join(serverDir(), "launcher.cjs")], {
      cwd: serverDir(),
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    server = child;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 90_000);
      child.on("message", (m) => {
        if (m && m.ready) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`exit ${code}`));
      });
    });

    child.once("exit", (code) => {
      server = null;
      if (quitting) return;
      log.write(`--- exited with ${code}\n`);
      const choice = dialog.showMessageBoxSync({ type: "error", message: T.serverStopped(), detail: `${T.seeLogs()} ${path.join(logsDir(), "server.log")}`, buttons: [T.restart(), T.close()], defaultId: 0 });
      if (choice === 0) {
        app.relaunch();
      }
      quitting = true;
      app.quit();
    });

    origin = `http://127.0.0.1:${port}`;
    // This launch's secret, and the session of the one person here — on the
    // window's own cookie jar, readable by no page script.
    await session.defaultSession.cookies.set({ url: origin, name: "lifeos_desktop", value: token, httpOnly: true, sameSite: "strict", path: "/" });
    await session.defaultSession.cookies.set({
      url: origin,
      name: "lifeos_session",
      value: Buffer.from(JSON.stringify({ email: LOCAL_IDENTITY })).toString("base64"),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    });
    return origin;
  }

  /**
   * Where the local app opens: the guided start the first time (as a new
   * account on the web), the island afterwards — once onboarding is done, or
   * once there is anything in the brain.
   */
  function startPath() {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "data", "lifeos.json"), "utf8"));
      const me = data && data[LOCAL_IDENTITY];
      const started = me && (me.profile?.onboardedAt || (Array.isArray(me.brain) && me.brain.length > 0));
      return started ? "/hub" : "/onboarding";
    } catch {
      return "/onboarding";
    }
  }

  /* ── The window ────────────────────────────────────────────────────── */

  function openExternal(url) {
    if (isExternalSafe(url)) shell.openExternal(url);
  }

  function guardNavigation(contents) {
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    const check = (event, url) => {
      if (!isAllowedNavigation(url, allowed)) {
        event.preventDefault();
        openExternal(url);
      }
    };
    contents.on("will-navigate", check);
    contents.on("will-redirect", check);
    contents.on("will-attach-webview", (event) => event.preventDefault());
  }

  function createWindow(url) {
    win = new BrowserWindow({
      width: 1320,
      height: 880,
      minWidth: 380,
      minHeight: 560,
      show: false,
      title: "LifeOS",
      backgroundColor: "#0b0b0d",
      autoHideMenuBar: true,
      icon: iconPath,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true },
    });
    guardNavigation(win.webContents);
    win.once("ready-to-show", () => win && win.show());
    win.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      win.hide();
      if (!toldAboutTray && tray) {
        toldAboutTray = true;
        tray.displayBalloon?.({ title: "LifeOS", content: T.stillRunning(), iconType: "info" });
      }
    });
    win.loadURL(url);
  }

  function show(pathname) {
    if (!win) return;
    if (pathname && origin) win.loadURL(origin + pathname);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /* ── Settings window ───────────────────────────────────────────────── */

  function openSettings() {
    if (settingsWin) {
      settingsWin.focus();
      return;
    }
    settingsWin = new BrowserWindow({
      width: 600,
      height: 760,
      resizable: true,
      minimizable: false,
      title: "LifeOS",
      backgroundColor: "#0b0b0d",
      autoHideMenuBar: true,
      icon: iconPath,
      parent: win ?? undefined,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, "preload.cjs") },
    });
    settingsWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    settingsWin.webContents.on("will-navigate", (event) => event.preventDefault());
    settingsWin.on("closed", () => (settingsWin = null));
    settingsWin.loadFile(path.join(__dirname, "ui", "settings.html"));
  }

  const fromSettings = (event) => {
    const url = event.senderFrame?.url ?? "";
    return settingsWin !== null && event.sender === settingsWin.webContents && url.startsWith("file:") && url.endsWith("/ui/settings.html");
  };

  ipcMain.handle("settings:get", (event) => {
    if (!fromSettings(event)) throw new Error("forbidden");
    return { ...publicConfig(readConfig()), encryption: safeStorage.isEncryptionAvailable(), locale: fr() ? "fr" : "en", version: app.getVersion() };
  });

  ipcMain.handle("settings:save", (event, update) => {
    if (!fromSettings(event)) throw new Error("forbidden");
    let result;
    try {
      result = applyUpdate(readConfig(), update, encrypt);
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.message === "encryption-unavailable" ? "encryption" : "failed" };
    }
    if (result.error) return { ok: false, error: result.error };
    writeConfig(result.config);
    // The server reads its keys and the window its address at start.
    setTimeout(() => {
      quitting = true;
      app.relaunch();
      app.quit();
    }, 300);
    return { ok: true };
  });

  /* ── Permissions ───────────────────────────────────────────────────── */

  function permit(permission, requestingUrl, details) {
    const fromApp = originOf(requestingUrl) === origin;
    if (!fromApp) return false;
    if (permission === "notifications" || permission === "clipboard-sanitized-write" || permission === "fullscreen") return true;
    // Voice memos and dictation: the microphone, never the camera.
    if (permission === "media") return (details?.mediaTypes ?? ["audio"]).every((t) => t === "audio");
    return false;
  }

  /* ── Start ─────────────────────────────────────────────────────────── */

  app.on("second-instance", () => show());

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (server) server.kill();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => callback(permit(permission, details.requestingUrl, details)));
    session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) =>
      permit(permission, requestingOrigin, { mediaTypes: details?.mediaType ? [details.mediaType] : undefined })
    );

    const config = readConfig();
    let start;
    if (config.mode === "cloud" && config.cloudUrl) {
      origin = config.cloudUrl;
      allowed = [origin, "https://*.supabase.co"];
      start = origin;
    } else {
      if (config.mode === "cloud") dialog.showMessageBoxSync({ type: "info", message: T.noCloud() });
      try {
        start = (await startServer(config)) + startPath();
        allowed = [origin];
      } catch (e) {
        dialog.showErrorBox("LifeOS", `${T.serverFailed()}\n\n${T.seeLogs()} ${path.join(logsDir(), "server.log")}\n(${e instanceof Error ? e.message : e})`);
        quitting = true;
        app.quit();
        return;
      }
    }

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "LifeOS",
          submenu: [
            { label: T.settings(), accelerator: "CommandOrControl+,", click: openSettings },
            { label: T.reload(), accelerator: "CommandOrControl+R", click: () => win?.webContents.reload() },
            { label: T.logs(), click: () => shell.openPath(logsDir()) },
            { type: "separator" },
            { label: T.quit(), accelerator: "CommandOrControl+Q", click: () => app.quit() },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      ])
    );

    createWindow(start);

    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
    tray.setToolTip("LifeOS");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: T.open(), click: () => show() },
        { label: `${T.capture()}  (Ctrl+Shift+Space)`, click: () => show("/brain?dump=1") },
        { label: T.settings(), click: openSettings },
        { type: "separator" },
        { label: T.quit(), click: () => app.quit() },
      ])
    );
    tray.on("click", () => show());

    globalShortcut.register(SHORTCUT, () => show("/brain?dump=1"));
  });
}
