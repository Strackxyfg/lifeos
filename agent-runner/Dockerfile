# LifeOS Agent Runner — deploy to a VPS, never to the owner's machine.
FROM node:22-alpine

# Explicit UID/GID 1000 so it matches the `user:` pin in docker-compose.yml.
# (Alpine's `adduser -S` allocates a system UID near 100, which would not.)
RUN addgroup -g 1000 -S agent \
 && adduser -u 1000 -S agent -G agent -s /sbin/nologin

WORKDIR /app
COPY index.mjs ./
RUN chown -R agent:agent /app

USER agent

# No package installs at runtime, no writable app dir, no shell for the user.
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
