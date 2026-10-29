FROM node:24.17.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server/*.ts ./server/
COPY server/repositories ./server/repositories
COPY server/database ./server/database
COPY src ./src
COPY scripts/start-review-service.ts scripts/review-admin.ts ./scripts/
RUN npx esbuild scripts/start-review-service.ts scripts/review-admin.ts --bundle --platform=node --format=cjs --packages=external --outdir=review-dist --out-extension:.js=.cjs

FROM node:24.17.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/review-dist ./review-dist
COPY server/database/supabase_schema.sql ./server/database/supabase_schema.sql
COPY server/database/migrations ./server/database/migrations
COPY deploy/review/runtime-schema.sql ./deploy/review/runtime-schema.sql
COPY deploy/review/least-privilege.sql ./deploy/review/least-privilege.sql
USER node
EXPOSE 3100
CMD ["node","review-dist/start-review-service.cjs"]
