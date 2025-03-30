Install CloudNative operator
    kubectl apply --server-side -f \
      https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.20/releases/cnpg-1.24.2.yaml

    kubectl apply --server-side -f \
      https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.20/releases/cnpg-1.20.6.yaml

Install DB cluster in namespace database
  apply ns.yaml
  apply db_cluster.yaml

Install cnpg plugin to interact with cluster
  curl -sSfL \
    https://github.com/cloudnative-pg/cloudnative-pg/raw/main/hack/install-cnpg-plugin.sh | \
    sudo sh -s -- -b /usr/local/bin


Kubernetes cluster upgrade
  first put the postgres cluster in maintenance mode
  upgrade the  kubernetes to the desired version.
  now you will see new nodes come online


argocd app create guestbook --repo https://github.com/snteks/homelab.git --path postgresDB --dest-server https://kubernetes.default.svc --dest-namespace database
