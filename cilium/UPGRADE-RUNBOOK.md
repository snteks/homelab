# Cilium Upgrade Runbook — Rancher Desktop (k3s)

## Prerequisites

- Rancher Desktop running with k3s
- `kubectl`, `helm`, and `rdctl` available
- Current context is `rancher-desktop`

## Pre-upgrade checklist

```bash
# 1. Record current state
helm list -n kube-system | grep cilium
kubectl -n kube-system get pods -l k8s-app=cilium
kubectl get nodes

# 2. Confirm k3s config is correct
rdctl shell cat /etc/rancher/k3s/config.yaml
# Expected:
#   flannel-backend: "none"
#   disable-network-policy: true
#   disable-kube-proxy: true

# 3. Check current Cilium health
kubectl -n kube-system exec ds/cilium -- cilium status --brief
```

## Upgrade steps

### Step 1: Update Gateway API CRDs (if required)

Check the [Cilium release notes](https://docs.cilium.io/en/stable/operations/upgrade/) for the required Gateway API CRD version.

```bash
GW_API_VERSION=v1.6.1  # update to match Cilium's requirement
BASE=https://raw.githubusercontent.com/kubernetes-sigs/gateway-api/${GW_API_VERSION}/config/crd

kubectl apply -f $BASE/standard/gateway.networking.k8s.io_gatewayclasses.yaml
kubectl apply -f $BASE/standard/gateway.networking.k8s.io_gateways.yaml
kubectl apply -f $BASE/standard/gateway.networking.k8s.io_httproutes.yaml
kubectl apply -f $BASE/standard/gateway.networking.k8s.io_referencegrants.yaml
kubectl apply -f $BASE/standard/gateway.networking.k8s.io_grpcroutes.yaml
kubectl apply -f $BASE/experimental/gateway.networking.k8s.io_tlsroutes.yaml
kubectl apply -f $BASE/standard/gateway.networking.k8s.io_backendtlspolicies.yaml
```

### Step 2: Update helm-values.yaml

Edit `helm-values.yaml` — update the version in the header comments. Review release notes for any new required or deprecated values.

### Step 3: Update Helm repo

```bash
helm repo update cilium
```

### Step 4: Diff before applying

```bash
NEW_VERSION=1.20.1  # set to target version

helm diff upgrade cilium cilium/cilium \
  --version $NEW_VERSION \
  -n kube-system \
  -f helm-values.yaml
```

> If `helm-diff` plugin is not installed: `helm plugin install https://github.com/databus23/helm-diff`

### Step 5: Upgrade

```bash
helm upgrade cilium cilium/cilium \
  --version $NEW_VERSION \
  -n kube-system \
  -f helm-values.yaml
```

### Step 6: Restart Cilium components

```bash
kubectl -n kube-system rollout restart deploy/cilium-operator ds/cilium
kubectl -n kube-system rollout status ds/cilium --timeout=300s
kubectl -n kube-system rollout status deploy/cilium-operator --timeout=120s
```

### Step 7: Update bootstrap.sh

Update `CILIUM_VERSION` in `bootstrap.sh` to match the new version.

## Post-upgrade verification

```bash
# Node should be Ready
kubectl get nodes

# All Cilium pods Running with 0 restarts
kubectl -n kube-system get pods -l k8s-app=cilium

# Cilium agent health
kubectl -n kube-system exec ds/cilium -- cilium status --brief

# kube-proxy replacement active
kubectl -n kube-system exec ds/cilium -- cilium status | grep KubeProxyReplacement

# GatewayClass accepted
kubectl get gatewayclass cilium \
  -o jsonpath='{.status.conditions[?(@.type=="Accepted")].status}'
# Must return: True

# No flannel residue
rdctl shell sh -c "ip link show flannel.1 2>&1; iptables-save | grep -c KUBE; ls /etc/cni/net.d/"
# Expected: "does not exist", 0, only 05-cilium.conflist

# DNS works
kubectl run dns-test --image=busybox:1.36 --restart=Never --rm -it \
  -- nslookup kubernetes.default.svc.cluster.local
```

## Rollback

```bash
helm rollback cilium -n kube-system
kubectl -n kube-system rollout restart deploy/cilium-operator ds/cilium
kubectl -n kube-system rollout status ds/cilium --timeout=300s
```

## Version history

| Date       | From   | To     | Notes                                      |
|------------|--------|--------|--------------------------------------------|
| 2026-08-21 | 1.19.1 | 1.20.1 | Added Gateway API, kube-proxy replacement  |
| 2026-03-13 | —      | 1.19.1 | Initial install                            |
