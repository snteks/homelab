# AGENTS.md — Actual Budget on Kubernetes (Personal Finance Tracker)

Instructions for any coding agent (Claude Code, etc.) working in this repository.
Read this entire file before generating or applying anything.

---

## 1. Mission

Deploy and operate **Actual Budget** (`actualbudget/actual-server`) on my **personal**
Kubernetes cluster for tracking personal finances. Produce production-quality,
GitOps-managed manifests. This is a single-user, single-replica, stateful app —
optimize for **data durability and access security**, not scale.

## 2. Hard Constraints (NEVER violate)

1. **NEVER deploy to a work/employer cluster or AWS account.** Before any `kubectl`
   or `helm`/`argocd` action, run `kubectl config current-context` and print it.
   If the context is not an explicitly allowed personal context (see §3), STOP and ask.
2. **`replicas: 1` always.** The app uses SQLite on a local data dir. More than one
   replica corrupts data. Deployment strategy MUST be `type: Recreate`
   (RollingUpdate + RWO PVC = deadlock or dual-writer corruption).
3. **Never use the `latest` image tag.** Pin an exact version tag (e.g. `25.x.y`)
   and record it in this repo. Upgrades are deliberate commits, not pull-time surprises.
4. **Never commit secrets** (server password, OIDC client secrets, SimpleFIN tokens)
   to Git. Use External Secrets Operator if available on the cluster; otherwise
   SOPS-encrypted secrets. Plaintext `Secret` YAML in Git is a hard failure.
5. **Never delete or recreate the PVC**, run `kubectl delete ns`, or any destructive
   operation against existing state without explicit human confirmation in the session.
6. **No public exposure without auth in front.** Default exposure is VPN/Tailscale-only
   or LAN-only ingress. Public ingress requires OIDC (see §7) and explicit approval.
7. **HTTPS is required.** The web client's crypto features break over plain HTTP on
   non-localhost origins. Terminate TLS at the ingress (cert-manager or equivalent).

## 3. Environment Assumptions (verify, don't guess)

At session start, discover and echo back:

- `kubectl config current-context` — allowed contexts: `<FILL IN: e.g. homelab, personal-eks>`
- Ingress controller in use (Traefik / ingress-nginx / Gateway API) — inspect the cluster.
- Default StorageClass and whether the CSI driver supports `VolumeSnapshot`
  (`kubectl get volumesnapshotclass`).
- Whether ArgoCD and External Secrets Operator are installed.
  - ArgoCD present → manage via an ArgoCD `Application` (App-of-Apps compatible).
  - ArgoCD absent → plain `kubectl apply -k` with kustomize; note this in the README.

Do not invent values for any of the above. Inspect or ask.

## 4. Repository Layout

```
.
├── AGENTS.md
├── README.md                  # runbook: deploy, upgrade, backup, restore
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml         # namespace: actual
│   ├── deployment.yaml
│   ├── service.yaml           # ClusterIP, port 5006
│   ├── pvc.yaml               # RWO, 2Gi is plenty; storageClass from §3
│   ├── networkpolicy.yaml
│   └── externalsecret.yaml    # or sops secret if no ESO
├── overlays/
│   └── prod/
│       ├── kustomization.yaml # image tag pin lives HERE
│       ├── ingress.yaml       # or httproute.yaml if Gateway API
│       └── backup/
│           ├── volumesnapshot-cron.yaml
│           └── (optional) restic/velero config
└── argocd/
    └── application.yaml       # only if ArgoCD present
```

## 5. Workload Spec Requirements

**Deployment:**
- `replicas: 1`, `strategy.type: Recreate`.
- Image: `actualbudget/actual-server:<PINNED>` (Docker Hub or `ghcr.io/actualbudget/actual`).
- Container port `5006`; env `ACTUAL_PORT=5006`.
- Data: mount PVC at `/data` (server files + user files both live under it by default).
- Env vars to set explicitly:
  - `ACTUAL_TRUSTED_PROXIES` — set to the ingress controller's pod/CIDR range so
    client IPs are honored correctly behind the proxy.
  - Upload limits only if importing large files fails
    (`ACTUAL_UPLOAD_FILE_SYNC_SIZE_LIMIT_MB`, etc.) — don't add speculatively.
- Security context: `runAsNonRoot: true`, drop all capabilities,
  `readOnlyRootFilesystem` if the image tolerates it (test; if writes outside /data
  fail, add emptyDir mounts for those paths rather than relaxing the root FS).
  Verify the image's expected UID/GID against the pinned version before hardcoding —
  set `fsGroup` so the PVC is writable.
- Probes: check whether the pinned version exposes a `/health` endpoint
  (`kubectl exec` + curl after first deploy, or check upstream source for that tag).
  Use httpGet if it exists; otherwise TCP probe on 5006. Do not guess an endpoint.
- Resources: start `requests: 100m/256Mi`, `limits: 512Mi` memory, no CPU limit.
  This is a small Node app; do not copy-paste enterprise sizing.

**NetworkPolicy:**
- Ingress: only from the ingress controller namespace on 5006.
- Egress: DNS + HTTPS only (needed for bank sync providers if enabled). Default-deny otherwise.

## 6. Backup & Restore — this is the actual deliverable

Untested backup = no backup. The budget data is irreplaceable personal financial history.

1. **Nightly CSI VolumeSnapshot** of the data PVC via CronJob or snapshot controller
   schedule. Retain ≥14 daily. SQLite snapshots are crash-consistent — acceptable for
   this write pattern, but that's why step 3 exists.
2. **Off-cluster copy**: if the cluster dies, snapshots on the same cluster/account are
   worthless. Ship a nightly restic (or velero) backup of `/data` to an off-cluster
   target (S3/B2). Note the RWO constraint: a backup job must either run on the same
   node as the pod (podAffinity) or back up from the snapshot, not the live PVC.
3. **Restore test is part of Definition of Done**: restore the latest snapshot into a
   scratch PVC, spin up a temporary second instance (different namespace, no ingress),
   confirm the budget opens and recent transactions are present. Document the exact
   commands in README.md as a runbook. Repeat quarterly.

## 7. Authentication & Exposure

- Default: server-password login, reachable only over Tailscale/VPN or LAN ingress.
- If (and only if) public exposure is explicitly requested: switch login method to
  OpenID Connect against my personal IdP, and keep the password fallback disabled.
  Never expose password-only auth to the public internet.
- If bank sync (SimpleFIN / GoCardless) is added later: those API tokens go through
  the same secret pipeline as §2.4, and the NetworkPolicy egress allowlist gets the
  provider endpoints — do not open egress to 0.0.0.0/0 for convenience.

## 8. Upgrade Procedure

1. Take an on-demand VolumeSnapshot.
2. Bump the pinned tag in `overlays/prod/kustomization.yaml`, read upstream release
   notes for that version (SQLite migrations are one-way).
3. Commit → sync → verify login + budget loads.
4. If broken: roll pod back to prior image ONLY if no schema migration ran; otherwise
   restore from the pre-upgrade snapshot. Say which path applies in the PR description.

## 9. Definition of Done (all must pass)

- [ ] `kubectl config current-context` confirmed personal before every apply.
- [ ] App reachable over HTTPS at the chosen hostname; login works.
- [ ] Pod survives deletion (`kubectl delete pod`) with data intact.
- [ ] Node drain / reschedule tested: pod comes back on another node with the PVC.
- [ ] Nightly snapshot CronJob has run at least once successfully.
- [ ] Off-cluster backup verified to exist at the remote target.
- [ ] **Restore test executed and documented** (§6.3).
- [ ] NetworkPolicy verified: `kubectl exec` curl from a random namespace fails.
- [ ] No secrets in Git history (`git log -p | grep -i password` sanity check + gitleaks).
- [ ] README runbook covers: deploy, upgrade, backup, restore, break-glass access.

## 10. Style & Conduct for the Agent

- Kustomize, not Helm, for this repo (single app, no templating need). If a Helm chart
  is ever preferred, propose it with tradeoffs first — don't switch unilaterally.
- Annotate non-obvious manifest decisions with a one-line comment citing the reason
  (e.g. `# Recreate: SQLite + RWO PVC, single writer only`).
- Prefer inspecting the cluster over assuming. Print what you found before acting.
- Small commits, imperative messages, one concern per commit.
- When uncertain between two safe options, pick the industry-standard one and note the
  tradeoff in the PR/commit body. When uncertain between a safe and a destructive
  option, always ask.
