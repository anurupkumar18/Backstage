# Build from the repo root: docker build -f deploy/web/Dockerfile -t backstage-web:dev .
# The web build reads contracts/ and fixtures/shared/ through Vite aliases, so the context is the repo root.
FROM node:22.23.3-alpine AS build
WORKDIR /repo
COPY contracts ./contracts
COPY fixtures/shared ./fixtures/shared
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci --no-audit --no-fund
COPY apps/web/index.html apps/web/stage.html apps/web/vite.config.ts apps/web/tsconfig.json ./apps/web/
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public
# VITE_ values are baked into the bundle. They are endpoints and flags only, never tokens.
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_MOCK_API=false
ARG VITE_ENABLE_VOICE=true
ARG VITE_BROWSER_OTLP_URL=/v1/traces
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_MOCK_API=$VITE_MOCK_API \
    VITE_ENABLE_VOICE=$VITE_ENABLE_VOICE \
    VITE_BROWSER_OTLP_URL=$VITE_BROWSER_OTLP_URL
RUN cd apps/web && npm run build

FROM node:22.23.3-alpine AS runtime
WORKDIR /app
COPY apps/web/server ./server
USER node
ENV PRESENCE_HOST=127.0.0.1 PRESENCE_PORT=8787
CMD ["node", "server/index.mjs"]

FROM nginx:1.30.5-alpine AS web
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
