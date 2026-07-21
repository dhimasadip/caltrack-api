FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
CMD ["npm", "run", "dev"]

FROM dependencies AS build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM dependencies AS migration
ENV NODE_ENV=production
COPY drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY src/db ./src/db
CMD ["npm", "run", "db:migrate"]

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs caltrack
COPY --from=build --chown=caltrack:nodejs /app/package.json /app/package-lock.json ./
COPY --from=build --chown=caltrack:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=caltrack:nodejs /app/dist ./dist
USER caltrack
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/server.js"]
