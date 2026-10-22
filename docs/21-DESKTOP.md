# LifeOS for Windows

`desktop/` builds `LifeOS-Setup-<version>.exe`: an installer (per user, no
admin rights) for an app that runs LifeOS on the computer, or opens the
person's LifeOS online.

> **Status.** Built and run on Windows 11 (Electron 44.7.0, electron-builder
> 26.17.0, both pinned): the packaged app starts its server, opens the guided
> start on first launch, then the island; the brain and billing pages render;
> the page has no access to Node and cannot read its session cookies. The
> local server's guard was probed: 403 without the launch secret, with a
> wrong one, with a rebinding Host header, on the API; 200 for the window.
> The settings window was checked with a stand-in bridge. The installer is
> **not code-signed**: Windows SmartScreen will warn until it is.

---

## 1. Build

```bash
cd desktop
npm install                       # Electron and electron-builder
node node_modules/electron/install.js   # only if the Electron binary did not download
npm run dist                      # server + installer → desktop/dist/
```

`npm run dist` runs `scripts/build-server.mjs` (a Next.js standalone build in
`.next-desktop`, Supabase variables blanked so the app runs on its local
store; output checked for `.env` files and anything shaped like a credential —
either fails the build), then electron-builder.

## 2. How it runs

| | On this computer (default) | Online |
|---|---|---|
| Server | the bundled LifeOS on `127.0.0.1`, a free port, started with Electron's Node | the person's deployment |
| Data | `%APPDATA%\LifeOS\data` (`LIFEOS_DATA_DIR`) | their account |
| Sign-in | automatic: one local person, `me@lifeos.local` | as on the web |
| AI keys | entered in Settings, encrypted by Windows (DPAPI), given to the server only | the deployment's |

Settings: menu LifeOS → Settings (Ctrl+,) or the tray icon. A change restarts
the app. Keys are never shown back.

## 3. Security

- **Windows**: `contextIsolation`, `sandbox`, no `nodeIntegration`; the main
  window has no preload at all. The settings window gets two calls (read,
  save), checked to come from the settings page.
- **Navigation**: only LifeOS loads inside (and `*.supabase.co` in online
  mode); other links open in the browser — web and mail links only. No new
  windows, no webviews.
- **Permissions**: notifications and the microphone (audio only), for LifeOS
  only; everything else refused.
- **Local server guard** (`server/guard.cjs`): the Host header must be the
  loopback address and port (DNS rebinding refused), and every request must
  carry the launch's random secret, set as an httpOnly cookie on the window's
  session — another browser or program on the machine has none.
- **Environment**: the server gets only the system variables it needs plus
  its own; a stray Supabase variable in the person's environment cannot
  change its mode.

## 4. Also

- Tray: open, quick capture, settings, quit. Closing the window keeps LifeOS
  running in the tray, so reminders still arrive (Windows notifications).
- Ctrl+Shift+Space from anywhere: quick capture.
- Logs: `%APPDATA%\LifeOS\logs\server.log` (menu LifeOS → logs folder).
- `LIFEOS_PROFILE_DIR` runs the app with a separate profile (testing).

## 5. Not done yet

- Code signing (a certificate is needed) and automatic updates (they need a
  signed release feed).
- In online mode, single sign-on through an identity provider other than
  Supabase opens in the browser, not in the app.
