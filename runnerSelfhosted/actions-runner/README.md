

helm template arc-controller oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller --version 0.10.1 > actions-runner/base/controller/controller.yaml


helm template arc-runner-set oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set --version 0.10.1 --set controllerServiceAccount.namespace=arc-system --set controllerServiceAccount.name=actions-runner-controller-gha-rs-controller > actions-runner/base/runner-set/runner-set.yaml




https://some-natalie.dev/blog/kaniko-in-arc/
https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners-with-actions-runner-controller/quickstart-for-actions-runner-controller
