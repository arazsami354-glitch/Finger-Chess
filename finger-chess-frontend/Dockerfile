# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public runtime config baked in at build time (Next.js inlines
# NEXT_PUBLIC_* vars into the client bundle) — pass these as --build-arg
# in CI for each environment rather than relying on a checked-in .env.
ARG NEXT_PUBLIC_FINGER_CHESS_API_PROXY_TARGET
ARG NEXT_PUBLIC_FINGER_CHESS_WS_URL
ARG NEXT_PUBLIC_FINGER_CHESS_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_FINGER_CHESS_API_PROXY_TARGET=$NEXT_PUBLIC_FINGER_CHESS_API_PROXY_TARGET
ENV NEXT_PUBLIC_FINGER_CHESS_WS_URL=$NEXT_PUBLIC_FINGER_CHESS_WS_URL
ENV NEXT_PUBLIC_FINGER_CHESS_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_FINGER_CHESS_STRIPE_PUBLISHABLE_KEY
RUN npm run build

# 'standalone' output (next.config.js) traces the minimal file set actually
# needed at runtime — this final image excludes the full node_modules tree
# and every unused source file, unlike a naive `next start` image.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 nodeapp && adduser -D -u 1001 -G nodeapp nodeapp

COPY --from=build --chown=nodeapp:nodeapp /app/.next/standalone ./
COPY --from=build --chown=nodeapp:nodeapp /app/.next/static ./.next/static
COPY --from=build --chown=nodeapp:nodeapp /app/public ./public

USER nodeapp
EXPOSE 3001
ENV PORT=3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/', (r) => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
