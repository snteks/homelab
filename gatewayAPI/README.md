# Gateway API — Runbook

Shared platform Gateway for the homelab Rancher Desktop (k3s) cluster.
All HTTP(S) traffic enters through a single Cilium-managed Gateway in
`gateway-system`. Applications attach `HTTPRoute` resources — Ingress is
blocked by Kyverno policy.

All apps are exposed as `<app>.dev.snteks.com` with TLS terminated at the
Gateway via a wildcard cert issued by Let's Encrypt (cert-manager + Cloudflare DNS01).

## Prerequisites

### Cilium (managed by `../cilium/`)

- Cilium installed with `gatewayAPI.enabled: true` and `kubeProxyReplacement: true`
- Gateway API CRDs installed at the correct version for the Cilium minor
- `GatewayClass cilium` accepted

```bash
kubectl get gatewayclass cilium \
  -o jsonpath='{.status.conditions[?(@.type=="Accepted")].status}'
# Must return: True
```

### cert-manager (managed by `../cert-manager/`)

- cert-manager installed and running
- `letsencrypt-prod` ClusterIssuer created with Cloudflare DNS01 solver
- Cloudflare API token secret (`cloudflare-api-token`) available in cert-manager namespace

```bash
kubectl get clusterissuer letsencrypt-prod \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
# Must return: True
```

### Cloudflare DNS

The Gateway uses `*.dev.snteks.com` for all application routing. Cloudflare
manages DNS for the `snteks.com` zone.

**DNS record setup:**

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) and select the `snteks.com` zone.

2. Go to **DNS > Records** and add a wildcard A record:

   | Type | Name   | Content               | Proxy status     | TTL  |
   |------|--------|-----------------------|------------------|------|
   | A    | `*.dev` | `<Gateway external IP>` | DNS only (grey) | Auto |

3. Determine your Gateway's external IP:
   ```bash
   kubectl -n gateway-system get gateway shared-gw \
     -o jsonpath='{.status.addresses[0].value}'
   ```
   - **LAN-only access:** use the node/VM IP (e.g. `192.168.x.x`). Only
     reachable from devices on the same network.
   - **Remote access:** use your public IP or a Tailscale/VPN IP. Set up port
     forwarding on your router for ports 80 and 443 to the cluster node.

4. **Important:** Use **DNS only** (grey cloud icon), NOT **Proxied** (orange cloud).
   - Grey cloud = traffic goes directly to your cluster. TLS terminates at the
     Gateway using the Let's Encrypt cert issued by cert-manager.
   - Orange cloud = Cloudflare terminates TLS and re-encrypts to your origin,
     which conflicts with cert-manager's DNS01 challenge flow and the Gateway's
     own TLS termination.

5. Verify DNS resolution:
   ```bash
   dig +short smoke.dev.snteks.com
   # Should return your Gateway IP
   ```

**Cloudflare API token (for cert-manager DNS01 challenges):**

cert-manager needs a Cloudflare API token to create TXT records for Let's Encrypt
DNS01 validation. This is managed by the `../cert-manager/` project via an
ExternalSecret. The token needs these permissions:

- **Zone > DNS > Edit** — for the `snteks.com` zone
- **Zone > Zone > Read** — for the `snteks.com` zone

### Optional

- Kyverno installed (for Ingress/Gateway enforcement policies — the policy is
  commented out in kustomization until Kyverno is available)

## Deploy

**With ArgoCD:**

```bash
kubectl apply -f argocd/application.yaml
```

**Without ArgoCD:**

```bash
kubectl apply -k overlays/prod
```

### Verify

```bash
# Gateway programmed with an address
kubectl -n gateway-system get gateway shared-gw
# PROGRAMMED=True, ADDRESS populated

# LoadBalancer service created
kubectl -n gateway-system get svc cilium-gateway-shared-gw
# TYPE=LoadBalancer, EXTERNAL-IP set

# TLS certificate issued
kubectl -n gateway-system get certificate
# READY=True

# Certificate secret created
kubectl -n gateway-system get secret wildcard-dev-snteks-com-tls
```

## Adding a New Application

1. Label the app namespace:
   ```bash
   kubectl label ns <app-namespace> gateway-access=true
   ```

2. Create an `HTTPRoute` in the app namespace:
   ```yaml
   apiVersion: gateway.networking.k8s.io/v1
   kind: HTTPRoute
   metadata:
     name: <app>
     namespace: <app-namespace>
   spec:
     parentRefs:
       - name: shared-gw
         namespace: gateway-system
     hostnames:
       - <app>.dev.snteks.com
     rules:
       - backendRefs:
           - name: <app-service>
             port: <port>
   ```

3. Verify the route is accepted:
   ```bash
   kubectl -n <app-namespace> get httproute <app> \
     -o jsonpath='{.status.parents[0].conditions[?(@.type=="Accepted")].status}'
   # Expected: True
   ```

4. Test access:
   ```bash
   curl -s https://<app>.dev.snteks.com/
   ```

## Smoke Test

A built-in smoke test route is included in `overlays/prod/httproute.yaml`.
Deploy a simple backend in the `smoke-test` namespace to use it:

```bash
kubectl -n smoke-test run smoke-web --image=nginx:alpine --labels=app=smoke-web
kubectl -n smoke-test expose pod smoke-web --port=80 --name=smoke-web

# Test via HTTPS (once cert is issued and DNS is configured)
curl -s https://smoke.dev.snteks.com/
# Expected: nginx welcome page (HTTP 200)

# Test via HTTP (cluster-internal, bypasses DNS/TLS)
kubectl run curl-test --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s -H "Host: smoke.dev.snteks.com" http://<gateway-ip>/
```

Cleanup:

```bash
kubectl delete ns smoke-test
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `GatewayClass cilium` missing or not Accepted | Cilium not configured for Gateway API | Fix in `../cilium/` project |
| Gateway `PROGRAMMED: False` | KPR not enabled or kube-proxy still running | Fix in `../cilium/` project |
| Gateway has no ADDRESS | ServiceLB disabled or LB Service pending | Confirm `svclb-*` pods exist |
| Certificate not issued / stuck | ClusterIssuer not ready, or Cloudflare API token missing | Check `kubectl describe certificate -n gateway-system` and `kubectl get clusterissuer letsencrypt-prod` |
| DNS01 challenge fails | Cloudflare API token lacks permissions, or zone is proxied (orange cloud) | Verify token permissions (Zone:DNS:Edit, Zone:Zone:Read); ensure DNS-only mode |
| `*.dev.snteks.com` doesn't resolve | Wildcard A record missing in Cloudflare | Add `*.dev` A record pointing to Gateway IP |
| Routes attach but 404 from Envoy | Namespace missing `gateway-access: "true"` label, or hostname mismatch | Check HTTPRoute status conditions (`Accepted`, `ResolvedRefs`) |
| Curl from host fails, cluster OK | Lima/WSL2 port-forward boundary or DNS not pointing to reachable IP | Test from inside VM (`rdctl shell`) to isolate; verify `dig +short <app>.dev.snteks.com` returns a reachable IP |

### Useful debug commands

```bash
# Gateway status
kubectl -n gateway-system get gateway shared-gw -o yaml | grep -A10 conditions

# Certificate status
kubectl -n gateway-system describe certificate wildcard-dev-snteks-com-tls

# cert-manager logs (for DNS01 challenge debugging)
kubectl -n cert-manager logs deploy/cert-manager --tail=50

# HTTPRoute conditions for a specific app
kubectl -n <ns> get httproute <name> -o yaml | grep -A5 conditions

# Kyverno policy test (once Kyverno is installed)
kubectl apply --dry-run=server -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: test-blocked
  namespace: default
spec:
  rules:
    - host: test.dev.snteks.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: test
                port:
                  number: 80
EOF
# Expected: denied by block-ingress-enforce-gateway-api
```
