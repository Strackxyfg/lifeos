"use strict";

/**
 * The local LifeOS server inside the desktop app: the Next.js production
 * build (standalone output), behind a guard that lets only the app's own
 * window in (`guard.cjs`). Started by the app with Electron's own Node
 * (`ELECTRON_RUN_AS_NODE`), on 127.0.0.1 and a free port it chose.
 */

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { allowed } = require("./guard.cjs");

const dir = __dirname;
const port = Number(process.env.PORT);
const token = process.env.LIFEOS_DESKTOP_TOKEN;
if (!Number.isInteger(port) || port <= 0 || !token || token.length < 32) {
  console.error("[lifeos] PORT and LIFEOS_DESKTOP_TOKEN are required.");
  process.exit(2);
}

// The build's own configuration, as the standalone server reads it.
const buildDir = fs
  .readdirSync(dir, { withFileTypes: true })
  .find((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "required-server-files.json")));
if (!buildDir) {
  console.error("[lifeos] No Next.js build found next to the launcher.");
  process.exit(2);
}
const { config } = JSON.parse(fs.readFileSync(path.join(dir, buildDir.name, "required-server-files.json"), "utf8"));

process.chdir(dir);
process.env.NODE_ENV = "production";
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);

const next = require("next");
const app = next({ dev: false, dir, hostname: "127.0.0.1", port, conf: config });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      if (!allowed(req.headers, { port, token })) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("Forbidden");
        return;
      }
      handle(req, res);
    });
    server.keepAliveTimeout = 65_000;
    server.listen(port, "127.0.0.1", () => {
      console.log(`[lifeos] ready on 127.0.0.1:${port}`);
      if (process.send) process.send({ ready: true, port });
    });
  })
  .catch((err) => {
    console.error("[lifeos] failed to start", err);
    process.exit(1);
  });
