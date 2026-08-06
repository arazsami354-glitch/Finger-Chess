# syntax=docker/dockerfile:1

# ============================================================================
# STAGE 1: deps — install all dependencies (including dev, needed to build)
# ============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ============================================================================
# STAGE 2: build — compile TypeScript and generate the Prisma client
# ============================================================================
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ============================================================================
# STAGE 3: prod-deps — install ONLY production dependencies, separately from
# the build stage, so dev dependencies (typescript, @nestjs/cli, jest, ...)
# never end up in the final image.
# ============================================================================
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
# Prisma's client needs its query engine binary regenerated against
# whatever schema is present — regenerate here too. The `prisma` CLI is kept
# in `dependencies` (not devDependencies) precisely so this stage has it
# available after the `--omit=dev` install; @prisma/client's runtime output
# is what gets copied into the final image.
COPY prisma ./prisma
RUN npx prisma generate

# ============================================================================
# STAGE 4: runtime — the actual image that ships. Alpine base, non-root
# user, only the compiled output + production node_modules.
# ============================================================================
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Runs as an unprivileged user — a compromised Node process (a supply-chain
# issue in a dependency, an unforeseen RCE in some parsing path) shouldn't
# also hand an attacker root inside the container.
RUN addgroup -g 1001 nodeapp && adduser -D -u 1001 -G nodeapp nodeapp

COPY --from=prod-deps --chown=nodeapp:nodeapp /app/node_modules ./node_modules
COPY --from=build --chown=nodeapp:nodeapp /app/dist ./dist
COPY --from=build --chown=nodeapp:nodeapp /app/prisma ./prisma
COPY --chown=nodeapp:nodeapp package.json ./

USER nodeapp

EXPOSE 3000

# Used by both Docker's own healthcheck and Kubernetes' liveness/readiness
# probes (see k8s/backend-deployment.yaml) — a plain TCP check isn't enough
# for a Node process that can accept connections while still deadlocked.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
