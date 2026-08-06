# Finger Chess — Infrastructure

Docker Compose (local dev) and Kubernetes manifests (production) for the three projects:
`finger-chess-backend`, `finger-chess-frontend`, `finger-chess-admin`.

## Layout Assumption

This folder expects to sit alongside the three project folders exactly as delivered:

```
finger-chess/
├── finger-chess-backend/
├── finger-chess-frontend/
├── finger-chess-admin/
└── finger-chess-infra/   ← this folder
```

## Local Development

```bash
cd finger-chess-infra
docker compose up --build
# first run only:
docker compose exec backend npx prisma migrate deploy
```

- Backend: `http://localhost:3000`
- Player frontend: `http://localhost:3001`
- Admin frontend: `http://localhost:5174`

Stripe/mail/OAuth/S3 features need real credentials — pass them via a `.env` file referenced in
`docker-compose.yml`'s `backend` service (commented placeholder included) rather than hardcoding
them into the compose file itself.

## Production: Kubernetes

Manifests are numbered for apply order (`kubectl apply -f k8s/` respects filename order for a
single directory, but the numbering also documents the dependency order for anyone reading them):

| File | Purpose |
|---|---|
| `00-namespace.yaml` | The `finger-chess` namespace everything else lives in |
| `01-configmap.yaml` | Non-secret backend config |
| `02-secret.template.yaml` | **Template only** — see the file's own header before using it |
| `10`-`12` | Backend Deployment, Service + PodDisruptionBudget, HorizontalPodAutoscaler |
| `20`, `21` | Both frontends' Deployment + Service + HPA |
| `30-ingress.yaml` | Routes all three hostnames, with WebSocket-specific timeout/affinity config |

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/01-configmap.yaml
# create the real secret separately — see 02-secret.template.yaml's header
kubectl apply -f k8s/10-backend-deployment.yaml -f k8s/11-backend-service.yaml -f k8s/12-backend-hpa.yaml
kubectl apply -f k8s/20-frontend-deployment.yaml
kubectl apply -f k8s/21-admin-frontend-deployment.yaml
kubectl apply -f k8s/30-ingress.yaml
```

### Why Postgres and Redis aren't in these manifests

Deliberately not provided as Kubernetes StatefulSets: **use managed services in production.**

- **Postgres**: this database holds real money (wallets, transactions, KYC records). RDS/Cloud
  SQL/managed Postgres gives you point-in-time recovery, automated failover, and backups without
  reimplementing all of that on top of a StatefulSet + PV — the operational cost of self-hosting a
  financial database correctly exceeds a managed service's price difference almost immediately.
- **Redis**: backs the matchmaking queues, Socket.IO cross-instance pub/sub (see
  `redis-io.adapter.ts`), and the new response cache (`CacheService`). ElastiCache/Memorystore with
  automatic failover is the equivalent recommendation — losing the Redis instance mid-deployment
  without failover means every active matchmaking queue and every WebSocket broadcast route drops
  at once, which is a much worse blast radius than losing the response cache (which just means the
  next request recomputes instead of hitting a cached value).

Local development's `docker-compose.yml` runs both directly for simplicity — that's a dev-only
convenience, not a deployment recommendation.

### Scaling Notes — What's Actually Stateless Now, and What Still Isn't

The backend Deployment runs 3+ replicas and autoscales (`12-backend-hpa.yaml`). The Socket.IO Redis
adapter (`redis-io.adapter.ts`, wired in `main.ts`) makes cross-instance WebSocket **broadcast**
correct — a move made by a player on pod A now correctly reaches their opponent on pod B.

**Still per-instance and not yet Redis-backed** (flagged consistently throughout this codebase,
restated here for the deployment-facing view of the same issue):
- `GameGateway`'s disconnect-grace and forfeit timers
- `MatchmakingGateway`'s queue-timeout and disconnect-grace timers, and its `onlineSockets` map
- `WsRateLimiter`'s token buckets (both gateways)

None of these cause *incorrect* behavior at multi-instance scale — a reconnect that lands on a
different pod than the one that started its grace timer will simply not have that specific timer
cancelled, so in the worst case a player who reconnects gets treated as if they hadn't (a forfeit
timer fires that shouldn't have) rather than anything unsafe. But it does mean behavior isn't
perfectly consistent across pods yet. The next infrastructure iteration for this platform should
replace these in-memory `Map`-based timers/limiters with Redis-backed equivalents (a sorted set of
scheduled expirations processed by a lightweight worker, or a library like BullMQ) — noted here as
the concrete next step now that horizontal scaling is otherwise wired up.
