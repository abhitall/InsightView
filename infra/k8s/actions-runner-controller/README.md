# Actions Runner Controller for InsightView

Deploys self-hosted GitHub Actions runners across multiple
Kubernetes regions so InsightView monitors can execute from
US-East, EU-West, and AP-Southeast simultaneously — closing the
"geographic distribution" gap from `docs/GAP_ANALYSIS.md` without
moving off the Actions-native execution model.

## Why

GitHub-hosted runners are useful but have three limitations:

1. **One location only.** Dynamic IPs in Azure's datacenter range;
   zero control over the origin of your monitoring traffic.
2. **Concurrency cap of 20** on the free tier. Any serious
   monitoring setup hits this during peak load.
3. **No private-network reach.** Requires Tailscale or similar
   tunnel on every run.

Self-hosted runners via ARC fix all three:

1. Pods run in your VPC / cluster with whatever topology you choose.
2. Scale out to whatever your cluster will tolerate.
3. Already inside the private network — no tunnel needed.

## Files

- `namespace.yaml`       — creates the `insightview-arc` namespace.
- `runner-scale-set.yaml` — declares three `AutoscalingRunnerSet`
  resources, one per region. Each has `minRunners: 1` so there's
  always one warm pod per region (cold-start is ~30s).

## Usage in a workflow

Once the scale sets are running, the InsightView workflows can
target them with a matrix:

```yaml
jobs:
  monitor:
    strategy:
      matrix:
        region: [us-east, eu-west, ap-southeast]
    runs-on: [self-hosted, insightview, "${{ matrix.region }}"]
    container:
      image: mcr.microsoft.com/playwright:v1.51.0-noble
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          command: native-run
          monitors_path: monitors
```

Every run fires three parallel jobs — one per region — and the
synthetic-kit's `location` field records which region each result
came from. Grafana dashboards filter by location.

## Install prerequisites

```bash
# 1. ARC controller
helm repo add actions-runner-controller \
  https://actions-runner-controller.github.io/actions-runner-controller
helm install arc actions-runner-controller/gha-runner-scale-set-controller \
  --namespace arc-systems --create-namespace

# 2. GitHub App secret (or PAT)
kubectl create secret generic insightview-gh-token \
  --namespace insightview-arc \
  --from-literal=github_token=ghp_yourPatHere

# 3. Apply the scale sets
kubectl apply -f namespace.yaml
kubectl apply -f runner-scale-set.yaml
```

ARC's controller will watch for jobs targeting
`self-hosted,insightview,<region>` and spin up pods on demand,
scaling back to `minRunners` after they've been idle for a
configurable period (default 5 minutes).

## Cost

For monitoring purposes, a fleet of `minRunners: 1` per region is
typically enough to absorb cron-triggered schedules. The per-pod
resource request (`2 CPU / 4 GB`) is sized for one Chromium at a
time. A 3-region deployment on GKE Spot nodes runs ~$15/month.
