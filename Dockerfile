FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY scripts/check-runtime.ts ./scripts/check-runtime.ts
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4174
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/check-runtime.ts ./scripts/check-runtime.ts
USER node
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "const http = require('node:http'); const req = http.get({ hostname: '127.0.0.1', port: process.env.PORT || 4174, path: '/api/health' }, res => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); }); req.setTimeout(4000, () => req.destroy()); req.on('error', () => process.exit(1));"]
CMD ["npm", "start"]
