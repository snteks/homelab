#!/usr/bin/env bash
# bootstrap.sh — Install Cilium on Rancher Desktop (local lab)
# Phases: 1) Disable flannel  2) Install Cilium  3) Verify
# This script is idempotent and gated — each phase validates before proceeding.

set -euo pipefail

CILIUM_VERSION="1.20.1"
NAMESPACE="kube-system"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
gate()  { echo -e "\n${YELLOW}--- $* ---${NC}"; }

# ---------------------------------------------------------------------------
# Gate 0: Environment detection
# ---------------------------------------------------------------------------
gate "Gate 0: Environment detection"

command -v rdctl    >/dev/null 2>&1 || error "rdctl not found. Is Rancher Desktop installed?"
command -v kubectl  >/dev/null 2>&1 || error "kubectl not found."
command -v helm     >/dev/null 2>&1 || error "helm not found."

CURRENT_CTX=$(kubectl config current-context 2>/dev/null || true)
[[ "${CURRENT_CTX}" == "rancher-desktop" ]] \
  || error "Current kubectl context is '${CURRENT_CTX}', expected 'rancher-desktop'. Aborting."

KERNEL=$(rdctl shell -- uname -r 2>/dev/null)
KERNEL_MAJOR=$(echo "${KERNEL}" | cut -d. -f1)
KERNEL_MINOR=$(echo "${KERNEL}" | cut -d. -f2)
if [[ "${KERNEL_MAJOR}" -lt 5 ]] || { [[ "${KERNEL_MAJOR}" -eq 5 ]] && [[ "${KERNEL_MINOR}" -lt 10 ]]; }; then
  error "Kernel ${KERNEL} is below 5.10. Cilium requires >= 5.10."
fi
info "Kernel: ${KERNEL} (OK)"

# Detect host OS to resolve override.yaml path
case "$(uname -s)" in
  Darwin) OVERRIDE_DEST="${HOME}/Library/Application Support/rancher-desktop/lima/_config/override.yaml" ;;
  Linux)  OVERRIDE_DEST="${HOME}/.local/share/rancher-desktop/lima/_config/override.yaml" ;;
  *)      error "Unsupported host OS: $(uname -s). Apply override.yaml manually." ;;
esac

info "Context : ${CURRENT_CTX}"
info "Override: ${OVERRIDE_DEST}"

# ---------------------------------------------------------------------------
# Phase 1: Disable flannel
# ---------------------------------------------------------------------------
gate "Phase 1: Disable flannel at the k3s layer"

FLANNEL_DISABLED=$(rdctl shell -- cat /etc/rancher/k3s/config.yaml 2>/dev/null | grep -c 'flannel-backend.*none' || true)

if [[ "${FLANNEL_DISABLED}" -gt 0 ]]; then
  info "Flannel already disabled in k3s config — skipping Phase 1 provisioning."
else
  info "Copying override.yaml to ${OVERRIDE_DEST}"
  mkdir -p "$(dirname "${OVERRIDE_DEST}")"
  cp "${SCRIPT_DIR}/override.yaml" "${OVERRIDE_DEST}"

  info "Restarting Rancher Desktop VM to apply provisioning..."
  rdctl shutdown
  rdctl start

  info "Waiting for VM and k3s to come up (up to 2 min)..."
  for i in $(seq 1 24); do
    sleep 5
    rdctl shell -- uname -r >/dev/null 2>&1 && break
    echo "  ...waiting (${i}/24)"
  done
fi

# Validation gate 1
FLANNEL_CFG=$(rdctl shell -- cat /etc/rancher/k3s/config.yaml 2>/dev/null || true)
echo "${FLANNEL_CFG}" | grep -q 'flannel-backend.*none' \
  || error "flannel-backend: none not found in k3s config. Phase 1 did not apply correctly."

FLANNEL_IFACE=$(rdctl shell -- ip link show flannel.1 2>&1 || true)
echo "${FLANNEL_IFACE}" | grep -q 'does not exist\|Cannot find device\|^$' \
  || warn "flannel.1 interface still exists — may cause CNI conflict. Investigate before proceeding."

info "Phase 1 validation passed. Node may be NotReady — that is expected."

# ---------------------------------------------------------------------------
# Phase 2: Install Cilium via Helm
# ---------------------------------------------------------------------------
gate "Phase 2: Install Cilium ${CILIUM_VERSION}"

helm repo add cilium https://helm.cilium.io 2>/dev/null || true
helm repo update cilium

CILIUM_STATUS=$(helm list -n "${NAMESPACE}" --filter '^cilium$' -o json 2>/dev/null \
  | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [[ "${CILIUM_STATUS}" == "failed" ]]; then
  warn "Previous Cilium release is in 'failed' state — uninstalling before reinstall."
  helm uninstall cilium -n "${NAMESPACE}" --wait
  CILIUM_STATUS=""
fi

if [[ "${CILIUM_STATUS}" == "deployed" ]]; then
  info "Cilium already deployed — running helm upgrade."
  helm upgrade cilium cilium/cilium \
    --version "${CILIUM_VERSION}" \
    --namespace "${NAMESPACE}" \
    -f "${SCRIPT_DIR}/helm-values.yaml"
else
  info "Installing Cilium ${CILIUM_VERSION}..."
  helm install cilium cilium/cilium \
    --version "${CILIUM_VERSION}" \
    --namespace "${NAMESPACE}" \
    -f "${SCRIPT_DIR}/helm-values.yaml"
fi

# Validation gate 2
info "Waiting for Cilium daemonset to roll out (up to 5 min)..."
kubectl -n "${NAMESPACE}" rollout status ds/cilium --timeout=300s

kubectl get nodes
kubectl -n "${NAMESPACE}" get pods -l k8s-app=cilium

NODE_STATUS=$(kubectl get nodes --no-headers | awk '{print $2}' | sort -u)
[[ "${NODE_STATUS}" == "Ready" ]] || error "Node is not Ready after Cilium install. Check 'kubectl -n kube-system get pods'."

info "Phase 2 validation passed. Cilium is running and node is Ready."

if command -v cilium >/dev/null 2>&1; then
  cilium status --wait || warn "cilium CLI status check failed — inspect manually."
fi

# ---------------------------------------------------------------------------
# Phase 3: Functional verification
# ---------------------------------------------------------------------------
gate "Phase 3: Functional verification"

info "Testing basic pod networking and DNS..."
kubectl run net-test --image=busybox:1.36 --restart=Never --rm -it \
  -- sh -c "nslookup kubernetes.default.svc.cluster.local && echo 'DNS OK'" \
  || error "DNS test failed. Check CoreDNS pods."

info "Running network policy smoke test..."
kubectl create ns policy-test 2>/dev/null || true

kubectl -n policy-test run web    --image=nginx:alpine    --labels=app=web    --restart=Never 2>/dev/null || true
kubectl -n policy-test run client --image=busybox:1.36    --labels=app=client --restart=Never \
  --command -- sleep 3600 2>/dev/null || true

kubectl -n policy-test wait pod --all --for=condition=Ready --timeout=120s

WEB_IP=$(kubectl -n policy-test get pod web -o jsonpath='{.status.podIP}')

info "Pre-policy check (expect SUCCESS)..."
kubectl -n policy-test exec client -- wget -qO- --timeout=5 "http://${WEB_IP}" \
  && info "Pre-policy connectivity: OK" \
  || warn "Pre-policy connectivity failed — check pod status."

info "Applying deny-all policy..."
kubectl apply -f "${SCRIPT_DIR}/policies/deny-all.yaml"
sleep 10

info "Post deny-all check (expect TIMEOUT/failure)..."
kubectl -n policy-test exec client -- wget -qO- --timeout=5 "http://${WEB_IP}" \
  && warn "Traffic still allowed after deny-all — policy enforcement may not be working." \
  || info "deny-all is enforced: connection blocked (expected)."

info "Applying allow-client-web policy..."
kubectl apply -f "${SCRIPT_DIR}/policies/allow-client-web.yaml"
sleep 3

info "Post allow check (expect SUCCESS)..."
kubectl -n policy-test exec client -- wget -qO- --timeout=5 "http://${WEB_IP}" \
  && info "allow-client-web policy: OK" \
  || error "Traffic still blocked after allow policy. Check CiliumNetworkPolicy."

info "Cleaning up policy-test namespace..."
kubectl delete ns policy-test

# ---------------------------------------------------------------------------
gate "Bootstrap complete"
info "Cilium ${CILIUM_VERSION} is installed and verified on rancher-desktop."
info "To enable kube-proxy replacement (Phase 4), run: helm upgrade cilium cilium/cilium \\"
info "  -n kube-system --reuse-values --set kubeProxyReplacement=true --set k8sServiceHost=<NODE_IP> --set k8sServicePort=6443"
