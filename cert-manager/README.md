# cert-manager — Runbook

cert-manager deployment and configuration (ClusterIssuers, Cloudflare DNS-01
secrets, network policies) for the homelab Rancher Desktop (k3s) cluster.
Provides TLS certificate issuance via Let's Encrypt for `*.dev.snteks.com`.

cert-manager is installed via pre-rendered Helm template output
(`base/helm-output.yaml`), applied through Kustomize. No Helm CLI is needed
at deploy time.

## Prerequisites

1. **Cilium + Gateway API CRDs** — managed by `../cilium/`.

   ```bash
   kubectl get gatewayclass cilium \
     -o jsonpath='{.status.conditions[?(@.type=="Accepted")].status}'
   # Must return: True
   ```

2. **Cloudflare API token** — see [Obtaining a Cloudflare API Token](#obtaining-a-cloudflare-api-token) below.

## Deploy

**With ArgoCD:**

```bash
kubectl apply -f argocd/application.yaml
```

**Without ArgoCD:**

```bash
# Apply all resources (cert-manager + CRDs + config + policies)
kubectl apply -k overlays/prod --server-side

# CRDs need a moment to register; then re-apply ClusterIssuers
kubectl wait --for=condition=Established crd/clusterissuers.cert-manager.io --timeout=60s
kubectl apply -f base/clusterissuer.yaml --server-side
```

## Verify

```bash
# cert-manager pods healthy
kubectl -n cert-manager get pods

# ClusterIssuers ready
kubectl get clusterissuer
# Both letsencrypt-staging and letsencrypt-prod should show READY=True

# Cloudflare secret exists
kubectl -n cert-manager get secret cloudflare-api-token
```

## Obtaining a Cloudflare API Token

1. Log in to the Cloudflare dashboard: https://dash.cloudflare.com
2. Go to **My Profile** (top-right avatar) -> **API Tokens**.
3. Click **Create Token** -> **Create Custom Token**.
4. Set permissions:
   - `Zone` — `Zone` — `Read`
   - `Zone` — `DNS` — `Edit`
5. Set zone resources:
   - `Include` — `Specific zone` — `snteks.com`
6. (Optional) Add IP filtering and/or token expiry for extra security.
7. Click **Continue to summary** -> **Create Token**.
8. Copy the token immediately (shown only once).

Create the Kubernetes secret:

```bash
kubectl -n cert-manager create secret generic cloudflare-api-token \
  --from-literal=api-token='<PASTE_TOKEN_HERE>'
```

**Security:** Never use the Global API Key. Scope to `snteks.com` only.
Never commit the token to Git. If leaked, revoke immediately in Cloudflare
and create a new one.

## Upgrade

To bump the cert-manager version, re-render the Helm template and re-apply:

```bash
helm repo update
helm template cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --version <NEW_VERSION> \
  --set crds.enabled=true \
  --set config.enableGatewayAPI=true \
  > base/helm-output.yaml

# Review the diff
git diff base/helm-output.yaml

# Apply
kubectl apply -k overlays/prod --server-side
```

After upgrading, verify ClusterIssuers are still Ready and the wildcard
cert in `gateway-system` remains valid.

## Backup

cert-manager state worth preserving:

- **ACME account keys**: secrets `letsencrypt-staging-key` and
  `letsencrypt-prod-key` in `cert-manager` namespace. Loss triggers
  re-registration (harmless but counts against rate limits).
- **Issued certificates**: secrets in `gateway-system`. Loss triggers
  re-issuance (counts against Let's Encrypt rate limits).

```bash
# Export ACME account keys
kubectl -n cert-manager get secret letsencrypt-prod-key -o yaml > backup-acme-prod-key.yaml
kubectl -n cert-manager get secret letsencrypt-staging-key -o yaml > backup-acme-staging-key.yaml
```

## Restore

1. Apply cert-manager and config:
   ```bash
   kubectl apply -k overlays/prod --server-side
   kubectl wait --for=condition=Established crd/clusterissuers.cert-manager.io --timeout=60s
   kubectl apply -f base/clusterissuer.yaml --server-side
   ```
2. Restore ACME account keys (if backed up):
   ```bash
   kubectl apply -f backup-acme-prod-key.yaml
   kubectl apply -f backup-acme-staging-key.yaml
   ```
3. Re-create the Cloudflare API token secret:
   ```bash
   kubectl -n cert-manager create secret generic cloudflare-api-token \
     --from-literal=api-token='<PASTE_TOKEN_HERE>'
   ```
4. Verify ClusterIssuers are Ready (see Verify section).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| ClusterIssuer not Ready | Cloudflare token missing or wrong scope | Verify secret; token needs `Zone:Read` + `Zone:DNS:Edit` |
| Challenge stuck pending | TXT record not created | Check Cloudflare audit log, verify token scope |
| Cert Ready but browser rejects | Using staging issuer | Check Gateway annotation references `letsencrypt-prod` |
| Rate limit errors | Too many prod issuances | Switch to staging, wait for reset |
| ClusterIssuer CRD not found | CRDs not yet registered | `kubectl wait --for=condition=Established crd/clusterissuers.cert-manager.io` then re-apply |

### Useful debug commands

```bash
# Full certificate chain status
kubectl describe certificate,certificaterequest,order,challenge -A

# cert-manager logs
kubectl -n cert-manager logs deploy/cert-manager --tail=50

# Check DNS-01 challenge progress
kubectl get challenges -A -o wide
```
