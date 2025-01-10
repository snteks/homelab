

helm template arc-controller oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller --version 0.10.1 > actions-runner/base/controller/controller.yaml


helm template arc-runner-set oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set --version 0.10.1 --set controllerServiceAccount.namespace=arc-system --set controllerServiceAccount.name=actions-runner-controller-gha-rs-controller > actions-runner/base/runner-set/runner-set.yaml


kubectl kustomize --enable-helm . | kubectl apply --server-side -f -
