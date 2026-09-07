# LifeOS Agent Runner — deploy to a VPS, never to the owner's machine.
FROM node:22-alpine

# The official Node images already ship an unprivileged `node` user at
# UID/GID 1000 — which is exactly what docker-compose.yml pins. Reuse it
# instead of creating one: `addgroup -g 1000` fails with "gid in use".
WORKDIR /app
COPY --chown=node:node index.mjs ./

USER node

# No package installs at runtime; the app directory is read-only at runtime
# (see docker-compose.yml), so nothing here can be modified in place.
ENV NODE_ENV=production
ENV POLL_MS=30000
# Touched after every successful cycle; the healthcheck reads it.
ENV HEARTBEAT_FILE=/tmp/lifeos-agent-heartbeat

# A real liveness probe: fail when the last cycle is older than three poll
# intervals. The previous `exit 0` check passed even with a wedged process.
HEALTHCHECK --interval=60s --timeout=10s --start-period=45s --retries=3 \
  CMD node -e "const s=require('fs').statSync(process.env.HEARTBEAT_FILE); \
process.exit(Date.now()-s.mtimeMs < Number(process.env.POLL_MS||30000)*3 ? 0 : 1)"

ENTRYPOINT ["node", "index.mjs"]
