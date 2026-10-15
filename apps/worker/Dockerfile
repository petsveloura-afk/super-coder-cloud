# Background worker image (container hosts: Railway, Fly.io, Render, any VM).
# Build from the REPOSITORY ROOT:  docker build -f apps/worker/Dockerfile -t scc-worker .
FROM node:22-alpine
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @scc/worker...
COPY apps/worker apps/worker
USER node
CMD ["node", "--experimental-strip-types", "apps/worker/src/index.ts"]
