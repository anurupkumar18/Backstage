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
# VITE_ values are baked into the bundle. They are endpoints and flags only, never tokens.
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_MOCK_API=false
ARG VITE_BROWSER_OTLP_URL=/otel
ARG VITE_SERVICE_VERSION=development
ARG VITE_DEPLOYMENT_ENVIRONMENT=demo
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_MOCK_API=$VITE_MOCK_API \
    VITE_BROWSER_OTLP_URL=$VITE_BROWSER_OTLP_URL \
    VITE_SERVICE_VERSION=$VITE_SERVICE_VERSION \
    VITE_DEPLOYMENT_ENVIRONMENT=$VITE_DEPLOYMENT_ENVIRONMENT
RUN cd apps/web && npm run build

FROM nginx:1.30.5-alpine
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
