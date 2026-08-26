# Actual Budget — Kubernetes Runbook

Personal finance tracker deployed on `admin@homelab` via GitOps (ArgoCD + Kustomize).

## Architecture

| Component | Value |
|-----------|-------|
| Image | `ghcr.io/actualbudget/actual-server` (tag pinned in `overlays/prod/kustomization.yaml`) |
| Namespace | `actual` |
| Storage | RWO PVC `actual-data`, 2Gi |
| Strategy | `Recreate` (SQLite + RWO = single writer) |
| Gateway | Cilium Gateway API (`shared-gw` in `gateway-system`) |
| TLS | cert-manager `letsencrypt-prod` ClusterIssuer |

---

## Prerequisites

Before applying, confirm:
```sh
kubectl config current-context   # must be: admin@homelab
```

Ensure the shared Gateway has an **HTTPS listener** configured (see `gatewayAPI/base/gateway.yaml`).
The `ReferenceGrant` in `overlays/prod/referencegrant.yaml` allows the gateway to use the TLS secret.

---

## Secret Management

The server password is **not** stored in Git. Create it manually before syncing:

```sh
cp secret.yaml.example secret.yaml
# Edit secret.yaml — set ACTUAL_SERVER_PASSWORD to a strong random value:
#   openssl rand -base64 32
kubectl apply -f secret.yaml
rm secret.yaml   # do not leave plaintext secrets on disk
```

Verify the secret exists before deploying:
```sh
kubectl get secret actual-server-secret -n actual
```

---

## Deploy

```sh
# Confirm context
kubectl config current-context   # admin@homelab

# Dry-run first
kubectl apply -k overlays/prod --dry-run=client

# Apply
kubectl apply -k overlays/prod
```

Or via ArgoCD:
```sh
kubectl apply -f argocd/application.yaml
# Then sync from the ArgoCD UI or:
argocd app sync actual-budget
```

**TODOs before first deploy:**
1. Set `storageClassName` in `base/pvc.yaml` to your cluster's StorageClass
   (`kubectl get storageclass` to list available classes)
2. Set `volumeSnapshotClassName` in `overlays/prod/backup/volumesnapshot-cron.yaml`
   (`kubectl get volumesnapshotclass` to list available classes)
3. Replace `actual.homelab.local` with your real hostname in `overlays/prod/httproute.yaml`
   and `overlays/prod/certificate.yaml`
4. Add the HTTPS listener to `shared-gw` in `gatewayAPI/base/gateway.yaml`

---

## Upgrade Procedure

1. Take an on-demand snapshot:
   ```sh
   kubectl apply -f - <<EOF
   apiVersion: snapshot.storage.k8s.io/v1
   kind: VolumeSnapshot
   metadata:
     name: actual-pre-upgrade-$(date +%Y%m%d)
     namespace: actual
   spec:
     volumeSnapshotClassName: longhorn-snapshot   # TODO: your class
     source:
       persistentVolumeClaimName: actual-data
   EOF
   ```

2. Bump the tag in `overlays/prod/kustomization.yaml`:
   ```yaml
   images:
     - name: ghcr.io/actualbudget/actual-server
       newTag: "25.X.Y"   # new version
   ```
   Read the upstream release notes for that version — SQLite migrations are one-way.

3. Commit → ArgoCD sync → verify login and budget loads.

4. If broken:
   - **No schema migration ran**: roll back the image tag and redeploy.
   - **Schema migration ran**: restore from the pre-upgrade snapshot (see §Restore below).

---

## Backup

### CSI Snapshots (nightly, on-cluster)
A CronJob runs nightly at 02:00 UTC creating a `VolumeSnapshot` of `actual-data`.
The 14 most recent snapshots are retained; older ones are pruned automatically.

```sh
# Verify latest snapshot
kubectl get volumesnapshot -n actual -l managed-by=snapshot-cron \
  --sort-by=.metadata.creationTimestamp

# Manually trigger a snapshot job
kubectl create job --from=cronjob/actual-snapshot manual-snap-$(date +%s) -n actual
```

### Off-cluster backup
> **Required before considering backup complete.** Snapshots on the same cluster/account
> are worthless if the cluster is destroyed.

TODO: configure restic or Velero to ship `/data` nightly to an off-cluster target (S3/B2).
The backup job must run on the same node as the actual pod (podAffinity on the RWO PVC)
or back up from a snapshot rather than the live PVC.

---

## Restore

### From CSI Snapshot (on-cluster)

```sh
# 1. Find the snapshot to restore from
kubectl get volumesnapshot -n actual --sort-by=.metadata.creationTimestamp

# 2. Scale down the deployment (Recreate strategy means the pod must be stopped first)
kubectl scale deployment actual -n actual --replicas=0

# 3. Delete the existing PVC (DESTRUCTIVE — confirm data is in the snapshot first)
kubectl delete pvc actual-data -n actual

# 4. Create a new PVC from the snapshot
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: actual-data
  namespace: actual
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 2Gi
  # storageClassName: longhorn   # TODO: your class
  dataSource:
    name: <SNAPSHOT_NAME>        # from step 1
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
EOF

# 5. Scale back up
kubectl scale deployment actual -n actual --replicas=1

# 6. Verify — open the UI and confirm recent transactions are present
```

### Restore Test (run quarterly)

Restore into a scratch namespace to avoid touching production:

```sh
# Create scratch namespace
kubectl create namespace actual-restore-test

# Create scratch PVC from latest snapshot
SNAP=$(kubectl get volumesnapshot -n actual -l managed-by=snapshot-cron \
  --sort-by=.metadata.creationTimestamp -o name | tail -1 | cut -d/ -f2)

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: actual-data
  namespace: actual-restore-test
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 2Gi
  dataSource:
    name: ${SNAP}
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
EOF

# Spin up a temporary pod (no ingress — accessed via port-forward only)
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: actual-restore-test
  namespace: actual-restore-test
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: actual-restore-test
  template:
    metadata:
      labels:
        app: actual-restore-test
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: actual
          image: ghcr.io/actualbudget/actual-server:25.7.1  # match prod tag
          ports:
            - containerPort: 5006
          env:
            - name: ACTUAL_PORT
              value: "5006"
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: actual-data
EOF

# Access via port-forward and verify budget opens + recent transactions present
kubectl port-forward -n actual-restore-test deploy/actual-restore-test 5006:5006

# Clean up after test
kubectl delete namespace actual-restore-test
```

---

## Break-Glass Access

If the Gateway is unavailable, access the app directly via port-forward:

```sh
kubectl port-forward -n actual svc/actual 5006:5006
# Then open http://localhost:5006 in your browser
```

---

## Verify NetworkPolicy

```sh
# Curl from a random namespace should fail (connection refused/timeout):
kubectl run curl-test --image=curlimages/curl:8.7.1 --rm -it --restart=Never \
  -- curl -v http://actual.actual.svc.cluster.local:5006
```

---

## Security Checklist

```sh
# Check for secrets in Git history
git log -p | grep -i password
git log -p | grep -i secret
```

No plaintext `Secret` YAML should appear. If it does, treat the secret as compromised and rotate.
