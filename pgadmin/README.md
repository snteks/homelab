k apply -f ns.yaml
k apply -f deployment.yaml

k port-forward svc/pgadmin-service 5050:80 -n web
