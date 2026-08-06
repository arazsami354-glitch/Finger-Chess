# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ARG VITE_FINGER_CHESS_API_PROXY_TARGET
ENV VITE_FINGER_CHESS_API_PROXY_TARGET=$VITE_FINGER_CHESS_API_PROXY_TARGET
RUN npm run build

# A Vite build is static files — no Node runtime needed to serve it, so the
# final image is nginx-alpine (a few MB) rather than carrying a full Node
# runtime for zero benefit.
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# Default upstream assumes docker-compose's service name. Override at runtime
# per environment (k8s sets it to http://finger-chess-backend); the official
# nginx entrypoint envsubsts it into the rendered default.conf at startup.
ENV FINGER_CHESS_BACKEND_UPSTREAM=http://backend:3000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
