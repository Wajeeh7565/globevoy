# GlobeVoy local-only container prototype.
# This intentionally starts the existing Node HTTP prototype, not the AWS Lambda handler.
# No provider credentials or AWS deployment configuration are baked into this image.
FROM node:24-bookworm-slim

WORKDIR /app
ENV PORT=8787

# Keep current backend code and data together so relative Node paths continue to work.
# The root package.json declares no runtime dependencies, so there is no npm ci step.
COPY --chown=node:node backend/ ./backend/

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "backend/server.js"]
