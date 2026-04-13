# InsightView RUM edge collector (Cloudflare Worker)

A sub-millisecond-cold-start edge proxy that sits in front of the
upstream RUM collector. Deploys to 330+ Cloudflare edge PoPs so
beacons from real users travel no further than their nearest edge.

## Why

The platform's `apps/rum-collector` is a Fastify service running in
one region. RUM traffic originates globally. Without an edge, a
user in Sydney pays ~200ms just to reach the collector in us-east-1.
A Worker drops that to < 5ms and enriches each beacon with
Cloudflare's free geo-IP before forwarding to the origin.

## Deploy

```bash
cd infra/cloudflare-worker
pnpm install -w   # installs wrangler in this isolated workspace
pnpm wrangler login
# Override the upstream URL for your environment:
pnpm wrangler secret put UPSTREAM_URL
pnpm wrangler secret put UPSTREAM_REPLAY_URL
pnpm wrangler deploy
```

The worker exposes:

- `POST /v1/events`  → forwards to the upstream RUM collector
- `POST /v1/replay`  → forwards session replay chunks

Point your RUM SDK at the worker URL instead of the upstream:

```js
InsightViewRUM.init({
  endpoint: "https://insightview-rum-edge.mycompany.workers.dev/v1/events",
  siteId: "my-site",
  autoInstrument: { webVitals: true, errors: true, replay: true },
});
```

## Free tier limits

Cloudflare Workers free tier gives 100k requests/day. For most
early-stage sites that's comfortably more than enough; larger
deployments should move to the paid tier (~$5/month for 10M
requests).

See the full rationale in `docs/adr/0007-actions-native-synthetic.md`
and the deployment considerations in `docs/ARCHITECTURE.md`.
