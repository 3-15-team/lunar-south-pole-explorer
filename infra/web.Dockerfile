# SPA build → nginx (the persistent scientific-data volume is mounted at /data)
FROM node:22-alpine AS build
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
FROM build AS check
COPY libs/lunarcore/tests/golden /app/libs/lunarcore/tests/golden
CMD ["npm", "run", "check"]

FROM build AS production-build
RUN npm run build

FROM nginx:1.27-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=production-build /app/apps/web/dist /usr/share/nginx/html
COPY --chmod=755 infra/web-config.sh /docker-entrypoint.d/40-web-config.sh
