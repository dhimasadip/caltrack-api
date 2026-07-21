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

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs caltrack
COPY --from=build --chown=caltrack:nodejs /app/package.json /app/package-lock.json ./
COPY --from=build --chown=caltrack:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=caltrack:nodejs /app/dist ./dist
USER caltrack
EXPOSE 3000
CMD ["node", "dist/src/server.js"]

