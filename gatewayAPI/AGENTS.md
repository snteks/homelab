# AGENTS.md — Gateway API on Rancher Desktop

Instructions for any coding agent (Claude Code, etc.) working in this directory.
Read this entire file before generating or applying anything.

---

## 1. Mission

Deploy and operate the **shared platform Gateway** as the **only** north/south
traffic entry standard on this local Rancher Desktop (k3s) cluster. Every
application exposes HTTP(S) via an `HTTPRoute` attached to `gateway-system/shared-gw`.
Ingress resources are prohibited and policy-enforced.

This project owns the **consumer side** of Gateway API only: the Gateway resource,
namespaces, HTTPRoutes, NetworkPolicies, and Kyverno enforcement. Cilium installation,
Helm values (`gatewayAPI.enabled`), and Gateway API CRDs are owned by the
`cilium/` project — see `../cilium/AGENTS.md`.

## 2. Hard Constraints (NEVER violate)

1. **Apps never create Gateways.** Apps create `HTTPRoute` objects that attach to
   `gateway-system/shared-gw`. Only platform automation modifies the Gateway.
2. **No Ingress objects, ever.** Blocked by Kyverno policy. Not "deprecated,"
   not "grandfathered."
3. **All cluster config is code.** Manual `kubectl edit` is for debugging only;
   the fix must land in the repo.
4. **Do not modify Cilium config from this project.** Cilium Helm values and
   Gateway API CRDs are managed in `../cilium/`. If `gatewayAPI.enabled` is
   missing or CRDs are outdated, fix it there — not here.

## 3. Prerequisites (owned by `cilium/`)

Before applying anything in this project, verify these are already in place
(managed by `../cilium/`):

- Cilium installed with `gatewayAPI.enabled: true` and `kubeProxyReplacement: true`
- Gateway API CRDs installed at the correct version for the Cilium minor
- `GatewayClass cilium` exists and `Accepted: True`
- Traefik disabled, kube-proxy disabled

```bash
kubectl get gatewayclass cilium \
  -o jsonpath='{.status.conditions[?(@.type=="Accepted")].status}'
# Must return: True — if not, fix in cilium/ first
```

## 4. Repository Layout

```
.
├── AGENTS.md
├── README.md                  # runbook: deploy, upgrade, verify, troubleshoot
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml         # namespace: gateway-system
│   ├── gateway.yaml           # shared-gw Gateway resource
│   ├── kyverno-policy.yaml    # block-ingress + deny-app-gateways
│   └── networkpolicy.yaml
├── overlays/
│   └── prod/
│       ├── kustomization.yaml
│       └── httproute.yaml     # smoke-test route
└── argocd/
    └── application.yaml       # only if ArgoCD present
```

- `base/` contains environment-agnostic manifests for the shared Gateway platform.
- `overlays/prod/` adds environment-specific config (smoke-test route, patches).
- No Cilium values or CRDs here — those belong in `../cilium/`.

## 5. Workload Spec Requirements

**Namespace:**
- `gateway-system` with label `app.kubernetes.io/managed-by: platform`.

**Gateway (`shared-gw`):**
- Single Gateway in `gateway-system`, `gatewayClassName: cilium`.
- HTTP listener on port 80 with namespace selector `gateway-access: "true"`.
- HTTPS listener: add once cert-manager with a local CA issuer is set up.
  Do not ship self-signed certs ad hoc.

**App-facing standard (every application MUST):**
1. Deploy into a namespace labeled `gateway-access: "true"`.
2. Ship an `HTTPRoute` referencing `gateway-system/shared-gw`, using hostname
   `<app>.dev.snteks.com` (DNS `*.dev.snteks.com` points to the Gateway IP via Cloudflare).
3. Never create: `Gateway`, `GatewayClass`, `Ingress`, or `Service` of type
   `LoadBalancer`/`NodePort` for HTTP traffic. ClusterIP + HTTPRoute only.

**Kyverno enforcement:**
- `block-ingress-enforce-gateway-api` ClusterPolicy with `Enforce` action.
- Denies all `Ingress` resources cluster-wide.
- Denies `Gateway` resources outside `gateway-system`.

**Template HTTPRoute (for apps to copy):**
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
    - <app>.localdev.me
  rules:
    - backendRefs:
        - name: <app-service>
          port: <port>
```

## 6. Definition of Done (all must pass)

- [ ] `GatewayClass cilium` exists and `Accepted: True` (prerequisite from cilium/).
- [ ] Gateway `shared-gw` is `PROGRAMMED: True` with ADDRESS populated.
- [ ] `cilium-gateway-shared-gw` Service has `EXTERNAL-IP` set.
- [ ] Smoke-test app reachable: `curl -H "Host: smoke.dev.snteks.com" http://127.0.0.1/` returns 200.
- [ ] Kyverno blocks Ingress (once Kyverno is installed).
- [ ] Kyverno blocks app Gateways outside `gateway-system` (once Kyverno is installed).
- [ ] No secrets in Git history.
- [ ] README runbook covers: deploy, verify, add app, troubleshoot.

## 7. Known Failure Modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `GatewayClass cilium` missing or not Accepted | Cilium not configured — this project's prerequisite | Fix in `../cilium/` |
| Gateway `PROGRAMMED: False` | kube-proxy still running / KPR not enabled | Fix in `../cilium/` |
| Gateway has no ADDRESS | ServiceLB disabled or LB Service pending | Confirm `svclb-*` pods exist |
| Routes attach but 404 | Namespace missing `gateway-access: "true"` label, or hostname mismatch | Check `HTTPRoute` status conditions |
| Curl from host fails, cluster OK | Lima/WSL2 port-forward boundary | Test from `rdctl shell` to isolate |

## 8. Style & Conduct for the Agent

- Kustomize for all manifests in this project.
- Prefer inspecting the cluster over assuming. Print what you found before acting.
- Small commits, imperative messages, one concern per commit.
- If a task seems to require Ingress (e.g., a Helm chart only supports Ingress),
  the answer is: disable the chart's Ingress, add an HTTPRoute alongside it.
  Do not relax the Kyverno policy.
