FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html manifest.json sw.js *.png *.ico ./
COPY public ./public
COPY client ./client
COPY scripts ./scripts
COPY server ./server
COPY database.rules.json ./
RUN npm run check && npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
