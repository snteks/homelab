# Instructions for Deploying the GitHub Runner Controller using Kustomize

This document provides step-by-step instructions for deploying the GitHub Runner Controller in a Kubernetes cluster using Kustomize.

## Kustomization Overview

The following is the Kustomization configuration used to deploy the GitHub Runner Controller:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
metadata:
  name: gh-runner-controller
  namespace: argocd

helmCharts:
  - name: gha-runner-scale-set-controller
    repo: oci://ghcr.io/actions/actions-runner-controller-charts
    version: 0.10.1
    releaseName: arc
    namespace: arc-systems
    includeCRDs: true

resources:
  - namespace-arc-systems.yaml
```

### Key Components

- **apiVersion**: Specifies the version of the Kustomize API being used.
- **kind**: Defines the type of resource, which is `Kustomization`.
- **metadata**: Contains metadata about the Kustomization, including its name and namespace.
- **helmCharts**: Lists Helm charts to be included in the deployment, specifying their names, repositories, versions, release names, and namespaces.
- **resources**: Lists additional resources to be applied, such as namespaces or other Kubernetes objects.

## Installation Steps

1. **Prepare Your Environment**:
   Ensure you have access to a Kubernetes cluster and that `kubectl` and `kustomize` are installed on your local machine.

2. **Create the Kustomization File**:
   Save the above YAML configuration in a file named `kustomization.yaml` in your working directory.

3. **Install the GitHub Runner Controller**:
   Run the following command to apply the Kustomization configuration to your Kubernetes cluster:

   ```bash
   kubectl kustomize --enable-helm . | kubectl apply --server-side -f -
   ```

   **Note**: Running this command will expand the Helm chart locally and apply it to your cluster.

## Important Note on Server-Side Apply

When using `kubectl apply`, you may encounter an error like:

```
metadata.annotations: Too long: must have at most 262144 bytes
```

In such cases, applying manifests with `--server-side` is recommended. This allows Kubernetes to manage metadata annotations more effectively and prevents issues related to size limitations.

## Current Date

*Friday, January 17, 2025, 4 PM EST*

By following these instructions, you should be able to successfully deploy the GitHub Runner Controller in your Kubernetes environment using Kustomize.
