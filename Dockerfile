FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/data \
    OPENCHATCUT_VPS=1 \
    OPENCHATCUT_KEYSTORE_PATH=/data/.openchatcut/settings.env \
    MEDIA_DIR=/data/media \
    CC_BROWSER_EXECUTABLE=/usr/bin/chromium \
    OPENCHATCUT_FFMPEG=/usr/bin/ffmpeg \
    OPENCHATCUT_FFPROBE=/usr/bin/ffprobe \
    PORT=5199

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates chromium curl ffmpeg fonts-liberation \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
      libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
      libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
      libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
      libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/media /data/projects

WORKDIR /app
COPY package.json package-lock.json ./
RUN ONNXRUNTIME_NODE_INSTALL=skip npm ci
COPY . .
RUN npm run build && npm run build:vps

EXPOSE 5199
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail http://127.0.0.1:5199/health || exit 1

CMD ["npm", "run", "start:vps"]
