# AGENTS.md — cert-manager Configuration (Rancher Desktop)

Instructions for any coding agent (Claude Code, etc.) working in this directory.
Read this entire file before generating or applying anything.

---

## 1. Mission

Deploy and operate **cert-manager** and its configuration (ClusterIssuers,
secrets, policies) for TLS certificate issuance on this local Rancher Desktop
(k3s) cluster. Real TLS from Let's Encrypt on the domain `snteks.com`, using
Cloudflare DNS-01 challenges exclusively.

This project owns the full cert-manager deployment: the Helm-templated
manifests (`base/helm-output.yaml`), ClusterIssuers, the Cloudflare API token
secret, and namespace policies. The shared Gateway that consumes certificates
is owned by `../gatewayAPI/`.

## 2. Hard Constraints (NEVER violate)

1. **DNS-01 only. Never configure HTTP-01.** This cluster is not
   internet-reachable; HTTP-01 challenges will always fail. All issuers use the
   Cloudflare DNS-01 solver.
2. **One wildcard certificate, one shared Gateway.** Applications MUST NOT
   create their own `Certificate`, `Issuer`, or `Gateway` resources. Apps
   attach via `HTTPRoute` to the shared Gateway in `gateway-system`.
3. **Staging issuer is the default for experiments.** `letsencrypt-staging`
   for anything under test. `letsencrypt-prod` is used exactly once, for the
   wildcard cert. Never point a test loop at the prod issuer.
4. **Never commit the Cloudflare API token.** It lives only in the Kubernetes
   Secret `cloudflare-api-token` in namespace `cert-manager`, created via
   ExternalSecret (preferred) or imperatively. Token is zone-scoped:
   `Zone:Read` + `Zone:DNS:Edit` on `snteks.com` only. Never use the Global
   API Key.
5. **Install order matters:** Gateway API CRDs -> Cilium -> cert-manager ->
   ClusterIssuers -> Gateway (triggers wildcard issuance). Do not reorder.
6. **All cluster config is code.** Manual `kubectl edit` is for debugging only;
   the fix must land in the repo.

## 3. Prerequisites

Before applying anything in this project, verify these are already in place:

- **Cilium** installed with `gatewayAPI.enabled: true` (managed by `../cilium/`)
- **Gateway API CRDs** installed at the correct version (managed by `../cilium/`)
- **Cloudflare API token** created (see section 8 for how to obtain one)

```bash
kubectl get gatewayclass cilium \
  -o jsonpath='{.status.conditions[?(@.type=="Accepted")].status}'
# Must return: True — if not, fix in cilium/ first
```

## 4. Repository Layout

```
.
├── AGENTS.md
├── README.md                  # runbook: deploy, upgrade, backup, restore
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml         # namespace: cert-manager
│   ├── values.yaml            # Helm values (Gateway API, DNS resolvers)
│   ├── helm-output.yaml       # cert-manager v1.17.1 (helm template -f values.yaml)
│   ├── clusterissuer.yaml     # staging + prod ClusterIssuers (DNS-01/Cloudflare)
│   ├── networkpolicy.yaml     # default-deny with ACME/DNS/API egress
│   └── externalsecret.yaml    # Cloudflare API token via ESO (commented out until ESO ready)
├── overlays/
│   └── prod/
│       └── kustomization.yaml
└── argocd/
    └── application.yaml       # only if ArgoCD present
```

- `base/values.yaml` contains the Helm values used to render `helm-output.yaml`.
  Edit this file to change cert-manager configuration, then re-render.
- `base/helm-output.yaml` is the output of `helm template -f values.yaml`.
  This allows installation via `kubectl apply -k` without requiring the Helm CLI
  at deploy time.
- `base/` contains environment-agnostic manifests for cert-manager and its config.
- `overlays/prod/` adds environment-specific patches or overrides.

## 5. Domain Layout

| Purpose | Name |
|---|---|
| Wildcard for all local apps | `*.dev.snteks.com` |
| Example app hostnames | `app1.dev.snteks.com`, `grafana.dev.snteks.com` |

Local resolution: DNS-01 proves domain ownership via TXT records, so no public
A record is required. Either add an **unproxied (grey-cloud)** A record
`*.dev.snteks.com -> 127.0.0.1` in Cloudflare, or use `/etc/hosts` entries.
Never enable the Cloudflare proxy (orange cloud) on these records.

## 6. Pinned Versions

| Component | Version | Notes |
|---|---|---|
| cert-manager | v1.17.1 | Gateway API support enabled; installed via helm template output |
| Gateway API CRDs | v1.2.x | Must match Cilium-supported version |
| Cilium | 1.17.x | `gatewayAPI.enabled=true` requires CRDs pre-installed |

## 7. Installation

cert-manager is installed entirely via Kustomize. The Helm chart is pre-rendered
into `base/helm-output.yaml` so no Helm CLI is needed at deploy time.

### Deploy

```bash
# Apply all resources (cert-manager + CRDs + ClusterIssuers + policies)
kubectl apply -k overlays/prod --server-side

# CRDs need a moment to register; then re-apply ClusterIssuers
kubectl wait --for=condition=Established crd/clusterissuers.cert-manager.io --timeout=60s
kubectl apply -f base/clusterissuer.yaml --server-side
```

### Upgrading cert-manager

To bump the cert-manager version, re-render the Helm template:

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm template cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --version <NEW_VERSION> \
  -f base/values.yaml \
  > base/helm-output.yaml

# Review diff, then apply
kubectl apply -k overlays/prod --server-side
```

Update the version in this AGENTS.md section 6 after upgrading.

## 8. Obtaining a Cloudflare API Token

The Cloudflare API token is required for DNS-01 challenges. Follow these steps
to create a correctly scoped token:

1. Log in to the Cloudflare dashboard: https://dash.cloudflare.com
2. Navigate to **My Profile** (top-right avatar) -> **API Tokens**.
3. Click **Create Token**.
4. Select **Create Custom Token** (do not use a template).
5. Configure the token permissions:
   - **Permissions:**
     - `Zone` — `Zone` — `Read`
     - `Zone` — `DNS` — `Edit`
   - **Zone Resources:**
     - `Include` — `Specific zone` — `snteks.com`
6. (Optional) Under **Client IP Address Filtering**, restrict to your public IP
   for additional security.
7. (Optional) Set a **TTL** (token expiry) if desired.
8. Click **Continue to summary**, then **Create Token**.
9. **Copy the token immediately** — it is shown only once.

### Create the Kubernetes Secret

```bash
kubectl -n cert-manager create secret generic cloudflare-api-token \
  --from-literal=api-token='<PASTE_TOKEN_HERE>'
```

### Verify the token works

```bash
# Check that the ClusterIssuers become Ready
kubectl get clusterissuer
# Both letsencrypt-staging and letsencrypt-prod should show READY=True

# If not ready, inspect the issuer status
kubectl describe clusterissuer letsencrypt-staging
```

**Security notes:**
- Never use the Cloudflare **Global API Key** — it grants full account access.
- The token must be scoped to `snteks.com` only.
- Never commit the token to Git. If leaked, revoke it immediately in the
  Cloudflare dashboard and create a new one.

## 9. Workload Spec Requirements

**Namespace:** `cert-manager` with label `app.kubernetes.io/managed-by: platform`.

**ClusterIssuers:**
- `letsencrypt-staging` — for testing, uses ACME staging endpoint.
- `letsencrypt-prod` — for the production wildcard cert only.
- Both use `dns01` solver with Cloudflare `apiTokenSecretRef`.

**Cloudflare API token Secret:**
- Name: `cloudflare-api-token`, namespace: `cert-manager`.
- Provisioned via ExternalSecret (if ESO is available) or imperatively (see section 8).

**NetworkPolicy:**
- Default deny with egress exceptions for DNS (53), HTTPS (443), and
  Kubernetes API (6443).

## 10. Definition of Done (all must pass)

- [ ] cert-manager pods Running in `cert-manager` namespace.
- [ ] `ClusterIssuer letsencrypt-staging` is `Ready: True`.
- [ ] `ClusterIssuer letsencrypt-prod` is `Ready: True`.
- [ ] Secret `cloudflare-api-token` exists in `cert-manager` namespace.
- [ ] Gateway annotation triggers wildcard cert issuance (`READY=True` in `gateway-system`).
- [ ] No secrets in Git history.
- [ ] README runbook covers: deploy, verify, upgrade, troubleshoot.

## 11. Known Failure Modes

| Symptom | Likely cause | Fix |
|---|---|---|
| ClusterIssuer not Ready | Cloudflare token missing or wrong scope | Verify secret exists; token needs `Zone:Read` + `Zone:DNS:Edit` |
| Challenge stuck pending | TXT record not created in Cloudflare | Check token scope, secret name/namespace, Cloudflare audit log |
| Cert `READY=True` but browser rejects | Using staging issuer (untrusted chain) | Check which issuer the Gateway annotation references |
| Rate limit errors from Let's Encrypt | Too many prod issuances (>50/week) | Switch to staging during churn, wait for rate limit reset |
| cert-manager pods crash | CRDs missing or version mismatch | Re-render helm template and re-apply |
| ClusterIssuer CRD not found on apply | CRDs not yet registered | Wait for CRD, then re-apply: `kubectl wait --for=condition=Established crd/clusterissuers.cert-manager.io` |

## 12. Rebuild Policy

Cluster resets are routine. ACME account keys and issued certs are
disposable — but every reset re-issues the wildcard against prod. If resets
exceed ~3/week, flip the Gateway annotation to `letsencrypt-staging` during
the churn window, then back to prod when stable.

## 13. Style & Conduct for the Agent

- Kustomize for all manifests in this project.
- Prefer inspecting the cluster over assuming. Print what you found before acting.
- Small commits, imperative messages, one concern per commit.
- Never create `Certificate` resources directly — the Gateway annotation
  handles issuance. If an edge case requires a standalone cert, flag it as a
  platform decision.
