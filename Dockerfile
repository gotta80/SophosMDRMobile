# --- 1) build frontend ---
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

# --- 2) build backend ---
FROM node:22-alpine AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server ./
RUN npm run build

# --- 3) runtime: unico container, il backend serve anche il frontend ---
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3456 STATIC_DIR=/app/public
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server /app/server/dist ./dist
COPY --from=web /app/web/dist ./public
USER node
EXPOSE 3456
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3456/api/health || exit 1
CMD ["node", "dist/index.js"]
