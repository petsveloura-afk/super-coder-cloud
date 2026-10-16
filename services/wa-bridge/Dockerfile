# SUPER CODER CLOUD — WhatsApp QR bridge (always-on).
# Railway: New Service → GitHub repo → Root Directory = services/wa-bridge
# Add a Volume mounted at /data (keeps WhatsApp sessions across deploys).
FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
ENV DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "src/server.mjs"]
