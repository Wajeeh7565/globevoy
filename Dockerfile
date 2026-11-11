FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=8787

COPY package.json ./
COPY backend/server.js ./backend/server.js
COPY backend/services/ ./backend/services/
COPY backend/data/ ./backend/data/

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health',{signal:AbortSignal.timeout(3000)}).then(async r=>process.exit(r.status===200&&(await r.json()).ok===true?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "backend/server.js"]
