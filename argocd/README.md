# ArgoCD Installation and Access Instructions

This document provides step-by-step instructions for installing ArgoCD in a Kubernetes cluster using Kustomize and accessing the ArgoCD UI.

## Prerequisites

- Access to a Kubernetes cluster
- `kubectl` and `kustomize` installed on your local machine

## Installation Steps

1. **Install ArgoCD**:
   Use the following command to install ArgoCD in your Kubernetes cluster:

   ```bash
   kubectl kustomize . | kubectl apply -f -
   ```

2. **Accessing ArgoCD**:
   After ArgoCD is installed, there are two ways to access it:

   ### Method 1: Port Forwarding to Access UI Locally

   To access the ArgoCD UI on your localhost, you can set up port forwarding with the following command:

   ```bash
   kubectl port-forward svc/argocd-server -n argocd 8080:443
   ```

   #### Retrieve Password and Login to ArgoCD

   Execute the following commands to retrieve the initial admin password and log in:

   ```bash
   export ARGO_PWD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)
   argocd login localhost:8080 --username admin --password $ARGO_PWD --insecure
   ```

   ### Method 2: GitHub Actions Step

   If you prefer using GitHub Actions, you can set up port forwarding as follows:

   ```yaml
   name: Setup Kubernetes port-forward daemon
   uses: <github-org>/shared-workflows/actions/k8s_port_forward@master
   with:
     workload: "svc/argocd-server"
     mappings: "8080:443"
     options: "--namespace=argocd"
   ```

   Then, use the following steps to log in to ArgoCD:

   ```yaml
   name: Port-forwarding setup & Argocd Login
   shell: bash
   run: |
     export ARGO_PWD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)
     argocd login localhost:8080 --username admin --password $ARGO_PWD --insecure
     echo "The login is successful"

     # Add GitHub repository to ArgoCD
     argocd repo add https://github.com/${{ github.repository }}.git --username ${{ inputs.ACTIONS_USER }} --password ${{ inputs.ACTIONS_TOKEN }} --upsert

     # Create a project in ArgoCD
     argocd proj create ${{ inputs.system }} --description "Project for all the portal system and subsystems"
     echo "The repo added successfully"

     # Create an application in ArgoCD
     argocd app create ${{ inputs.application }} \
       --repo https://github.com/${{ github.repository }}.git \
       --path ${{ inputs.kustomize-path}} \
       --dest-server https://kubernetes.default.svc \
       --dest-namespace ${{ inputs.namespace }} \
       --revision ${{ github.ref }} \
       --directory-recurse=false \
       --upsert \
       --sync-policy none

     # Sync the application
     argocd app sync ${{ inputs.application }} --prune
   ```

## Conclusion

You have successfully installed ArgoCD in your Kubernetes cluster and learned how to access it both locally and through GitHub Actions. Follow these instructions to manage your applications effectively using ArgoCD and Kustomize.


You have now installed ArgoCD in your Kubernetes cluster and learned how to access it both locally and via GitHub Actions. Follow these steps to manage your applications effectively with ArgoCD!

retrieve current k8s context
    kubectl config current-context

Added k8s cluster to argocd
    argocd cluster add rancher-desktop