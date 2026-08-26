# AGENTS.md — Cilium on Rancher Desktop (local lab)

## Mission

Replace the default k3s CNI (flannel) in Rancher Desktop with Cilium, verify it end-to-end, and leave the cluster in a reproducible state. This is a **local lab** for authoring/testing CiliumNetworkPolicies and Hubble observability. It is NOT representative of EKS datapath behavior (no ENI mode, no cloud LB integration). Do not extrapolate performance or ENI-specific behavior from this environment.

## Hard rules for the agent

1. **Never install Cilium while flannel is still active.** Two CNIs = silently broken pod networking. Flannel must be disabled at the k3s layer first (Phase 1), verified, then Cilium installed (Phase 2).
2. **Never run `rdctl factory-reset` or delete the Rancher Desktop VM without explicit user confirmation.** It destroys all local images and cluster state.
3. **Do not "fix" NotReady nodes by re-enabling flannel.** NotReady is the expected state between Phase 1 and Phase 2.
4. **All provisioning must be idempotent.** Rancher Desktop re-runs provisioning on every VM start and wipes VM-internal state on k3s version changes. Config lives in the override/provisioning files on the host, never hand-edited inside the VM.
5. **Stop and report if kernel < 5.10 or bpffs is unavailable.** Do not attempt workarounds.
6. Phases are gated. Do not proceed past a failed validation gate.

## Environment detection (run first, always)

```bash
rdctl version                      # Rancher Desktop present?
kubectl config current-context     # must be: rancher-desktop
kubectl get nodes -o wide          # note INTERNAL-IP, k3s version
rdctl shell -- uname -r            # kernel >= 5.10 required (5.15+ typical)
rdctl shell -- mount | grep bpf    # bpffs should be mountable/mounted
rdctl shell -- ls /sys/fs/cgroup/cgroup.controllers  # confirms cgroup v2
```

Record OS (macOS/Linux → Lima VM, Windows → WSL2) because provisioning file paths differ:

| Host OS | Provisioning mechanism |
|---|---|
| macOS | `~/Library/Application Support/rancher-desktop/lima/_config/override.yaml` |
| Linux | `~/.local/share/rancher-desktop/lima/_config/override.yaml` |
| Windows | `%APPDATA%\rancher-desktop\provisioning\*.start` scripts (WSL2) |

**Resource gate:** Rancher Desktop VM must have ≥ 4 GB RAM / 2 CPU (8 GB preferred). Check in Rancher Desktop Preferences or `rdctl list-settings`. If below, ask the user to raise it before proceeding — cilium-agent + operator + k3s on 2 GB will OOM-loop and waste an hour of debugging.

## Phase 1 — Disable flannel at the k3s layer

k3s reads `/etc/rancher/k3s/config.yaml` inside the VM. Provision it from the host so it survives restarts.

**macOS/Linux** — write (merge, don't clobber existing keys) into `override.yaml`:

```yaml
provision:
  - mode: system
    script: |
      #!/bin/sh
      set -e
      mkdir -p /etc/rancher/k3s
      cat > /etc/rancher/k3s/config.yaml <<'EOF'
      flannel-backend: "none"
      disable-network-policy: true
      EOF
```

**Windows** — create `%APPDATA%\rancher-desktop\provisioning\disable-flannel.start`:

```sh
#!/bin/sh
set -e
mkdir -p /etc/rancher/k3s
cat > /etc/rancher/k3s/config.yaml <<'EOF'
flannel-backend: "none"
disable-network-policy: true
EOF
```

Then restart the VM: `rdctl shutdown && rdctl start` (or restart via the UI).

**Validation gate 1:**
```bash
rdctl shell -- cat /etc/rancher/k3s/config.yaml   # must show flannel-backend: "none"
kubectl get nodes                                  # NotReady is EXPECTED and CORRECT here
kubectl -n kube-system get pods                    # coredns Pending/ContainerCreating is expected
rdctl shell -- ip link show flannel.1 2>&1         # should NOT exist (or errors "does not exist")
```
If the node is Ready with flannel interfaces present, the config was not picked up — debug the provisioning path before continuing. Do NOT install Cilium.

## Phase 2 — Install Cilium

Use Helm (declarative, versionable). Pin the version — check https://github.com/cilium/cilium/releases for current stable and record the choice.

```bash
helm repo add cilium https://helm.cilium.io
helm repo update

helm install cilium cilium/cilium \
  --version <PINNED_VERSION> \
  --namespace kube-system \
  --set operator.replicas=1 \
  --set ipam.mode=kubernetes \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true
```

Notes:
- `operator.replicas=1` — single node; default 2 leaves one Pending forever.
- `ipam.mode=kubernetes` — k3s still allocates podCIDRs via controller-manager even with flannel off; use them.
- **kube-proxy stays enabled in v1.** Do not set `kubeProxyReplacement=true` in the first pass. Get CNI + policy + Hubble working on a known-good base first. KPR is a Phase 4 stretch goal with its own failure modes (k8sServiceHost bootstrapping chicken-and-egg on a single node).

**Validation gate 2:**
```bash
kubectl -n kube-system rollout status ds/cilium --timeout=300s
kubectl get nodes                          # Ready now
kubectl -n kube-system get pods            # coredns Running, cilium Running
cilium status --wait                       # if cilium CLI installed; otherwise skip
```

## Phase 3 — Functional verification

```bash
# Basic pod networking + DNS
kubectl run net-test --image=busybox:1.36 --restart=Never --rm -it -- \
  sh -c "nslookup kubernetes.default.svc.cluster.local && wget -qO- --timeout=5 http://kubernetes.default.svc.cluster.local:443 || true"

# Policy enforcement smoke test: deny-all then allow
kubectl create ns policy-test
kubectl -n policy-test run web --image=nginx:alpine --labels=app=web
kubectl -n policy-test run client --image=busybox:1.36 --labels=app=client --command -- sleep 3600
kubectl -n policy-test wait pod --all --for=condition=Ready --timeout=120s

# Pre-policy: expect SUCCESS
kubectl -n policy-test exec client -- wget -qO- --timeout=3 http://$(kubectl -n policy-test get pod web -o jsonpath='{.status.podIP}')

# Apply default-deny CiliumNetworkPolicy, then expect the same command to TIME OUT.
# Then apply an allow policy (app=client -> app=web :80) and expect SUCCESS again.
```

Write the two CNPs to `./policies/` as artifacts; do not inline-apply with heredocs that leave no trace.

Hubble check:
```bash
cilium hubble port-forward &
hubble observe --namespace policy-test --last 20   # should show DROPPED verdicts during deny window
```

`cilium connectivity test` may be run but EXPECT some tests to skip/fail on a single node (multi-node and LB tests). Report skips as informational, not failures.

**Cleanup:** `kubectl delete ns policy-test`

## Phase 4 (optional, only on explicit request) — kube-proxy replacement

Prereqs: Phases 1–3 green. Add to k3s config.yaml: `disable-kube-proxy: true`, restart VM, then:

```bash
NODE_IP=$(kubectl get node -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
helm upgrade cilium cilium/cilium -n kube-system --reuse-values \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=${NODE_IP} \
  --set k8sServicePort=6443
```

Known trap: if cilium pods can't reach the API server after this change, `k8sServiceHost` is wrong (VM IP changed on restart — Lima IPs are not stable). Rollback: remove `disable-kube-proxy`, `helm upgrade --set kubeProxyReplacement=false`, restart VM.

## Known failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Pods stuck ContainerCreating after Cilium install | flannel CNI conf still in `/etc/cni/net.d/` | `rdctl shell -- ls /etc/cni/net.d/`; remove flannel conflist; restart cilium ds |
| cilium-agent CrashLoopBackOff, logs mention bpf | bpffs not mounted / old kernel | Check gate 0; Cilium usually auto-mounts — if not, provisioning script adds `mount bpffs /sys/fs/bpf -t bpf` |
| Everything breaks after Rancher Desktop upgrade | k3s data reset, provisioning re-ran but Helm state gone | Re-run Phase 2; this is why versions are pinned |
| coredns CrashLoop after KPR | k8sServiceHost stale VM IP | See Phase 4 rollback |
| Node Ready immediately after Phase 1 restart | override.yaml not read (wrong path / YAML merge error) | Validate path per OS table; `rdctl shell -- cat /etc/rancher/k3s/config.yaml` |

## Rollback (full)

1. Delete provisioning override / `.start` script on host.
2. `helm uninstall cilium -n kube-system`
3. `rdctl shutdown && rdctl start` — k3s redeploys flannel automatically.
4. If networking remains broken: ask user for permission, then Rancher Desktop → "Reset Kubernetes" (NOT factory reset).

## Deliverables the agent must produce

- `override.yaml` or `.start` provisioning file (host path recorded)
- `helm-values.yaml` capturing all non-default values (convert the `--set` flags after first success)
- `./policies/deny-all.yaml`, `./policies/allow-client-web.yaml`
- A short `SETUP-LOG.md`: detected environment, pinned versions, gate results, deviations
