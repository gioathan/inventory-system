# Kubernetes manifests (Steps 10 & 11)

Local-only, learning-focused Kubernetes manifests for this project, run against a `k3d` cluster
(k3s packaged to run as Docker containers — see `docs/architecture.md`). This is **not** meant
to replace Aspire for day-to-day development; Aspire's `AppHost.cs` is still the fast inner loop.
This is for learning/rehearsing how the same services run on real Kubernetes.

All 6 services now have manifests, plus their own Postgres instances (one each for
catalog/inventory/staff — not shared like Aspire's local setup, see `docs/architecture.md`),
a shared RabbitMQ, MongoDB, and Redis. **Linkerd is installed and every Pod in the namespace is
meshed** (mTLS between pods, verified — see the Service Mesh section of `docs/architecture.md`);
application code still talks plain HTTP internally regardless, since the mesh's encryption is
invisible to it. That plaintext-at-the-app-layer reality is why the gRPC-hosting services
(Catalog, Inventory) and their callers (Scan Gateway, Dashboard) needed a few Kubernetes-specific
tweaks documented inline in the manifests and in `TECH_DEBT.md`.

## Prerequisites

- `k3d` cluster running: `k3d cluster create inventory-system --wait`
- `kubectl` pointed at it (k3d does this automatically): `kubectl config current-context` should
  print `k3d-inventory-system`
- If `kubectl` hangs or can't connect after time away from this machine, see the
  `host.docker.internal` entry in `TECH_DEBT.md` before reaching for a full Docker Desktop
  restart — usually a one-line kubeconfig fix.

## Install Linkerd (one-time per cluster)

```
linkerd check --pre
linkerd install --crds | kubectl apply -f -
linkerd install | kubectl apply -f -
linkerd viz install | kubectl apply -f -
linkerd check
```

`k8s/namespace.yaml` already carries the `linkerd.io/inject: enabled` annotation, so applying it
(see below) is enough for every future Pod in the namespace to get meshed automatically — no
per-manifest changes needed. If pods were already running before Linkerd was installed, mesh them
with `kubectl rollout restart deployment -n inventory-system`.

Useful commands once it's running:

```
linkerd viz stat deploy -n inventory-system      # live RPS / success rate / latency per pod
linkerd viz edges deployment -n inventory-system # confirms SECURED: √ between every pair
```

## Build and load the images

k3d's nodes are separate containerd instances from Docker Desktop's own image store — an image
built with `dotnet publish` locally is invisible to the cluster until you import it explicitly
(no registry needed for local dev):

```
dotnet publish src/Services/Catalog/Catalog.Api -c Release -t:PublishContainer -p:ContainerRepository=catalog-api -p:ContainerImageTag=dev --os linux --arch x64
dotnet publish src/Services/Inventory/Inventory.Api -c Release -t:PublishContainer -p:ContainerRepository=inventory-api -p:ContainerImageTag=dev --os linux --arch x64
dotnet publish src/Services/Staff/Staff.Api -c Release -t:PublishContainer -p:ContainerRepository=staff-api -p:ContainerImageTag=dev --os linux --arch x64
dotnet publish src/Services/Notification/Notification.Api -c Release -t:PublishContainer -p:ContainerRepository=notification-api -p:ContainerImageTag=dev --os linux --arch x64
dotnet publish src/Services/ScanGateway/ScanGateway.Api -c Release -t:PublishContainer -p:ContainerRepository=scan-gateway -p:ContainerImageTag=dev --os linux --arch x64
dotnet publish src/Services/Dashboard/Dashboard.Api -c Release -t:PublishContainer -p:ContainerRepository=dashboard-api -p:ContainerImageTag=dev --os linux --arch x64

k3d image import catalog-api:dev inventory-api:dev staff-api:dev notification-api:dev scan-gateway:dev dashboard-api:dev -c inventory-system
```

Re-run for whichever image changed, then re-import it and `kubectl rollout restart
deployment/<name> -n inventory-system` — there's no volume-mount hot reload here like Aspire's
`dotnet run`; that's the actual cost of the "closer to production" tradeoff. Note that
`kubectl port-forward` targets a specific pod, so a rollout restart breaks any port-forward
pointed at the old pod — just re-run the `port-forward` command after a restart.

## Apply

```
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/catalog-postgres.yaml
kubectl apply -f k8s/inventory-postgres.yaml
kubectl apply -f k8s/staff-postgres.yaml
kubectl apply -f k8s/rabbitmq.yaml
kubectl apply -f k8s/mongo.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/catalog-api.yaml
kubectl apply -f k8s/inventory-api.yaml
kubectl apply -f k8s/staff-api.yaml
kubectl apply -f k8s/notification-api.yaml
kubectl apply -f k8s/scan-gateway.yaml
kubectl apply -f k8s/dashboard-api.yaml
```

## Verify

```
kubectl get pods -n inventory-system
```

All 12 pods (6 services + 6 infra) should reach `1/1 Running`. A restart count of 1 on a
service that talks to RabbitMQ/Postgres right after first apply is expected — see the
"no equivalent of `WaitFor()`" entry in `TECH_DEBT.md`; it self-heals.

Port-forward whichever service you want to hit directly:

```
kubectl port-forward -n inventory-system svc/staff-api 8090:80
kubectl port-forward -n inventory-system svc/scan-gateway 8091:80
kubectl port-forward -n inventory-system svc/dashboard-api 8092:80
```

Then, from another shell, the same flow as testing against Aspire — log in, then use the token
everywhere:

```
TOKEN=$(curl -s -X POST http://localhost:8090/auth/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ChangeMe123!"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')

curl -s -X POST http://localhost:8091/categories -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"name":"Test Category"}'

curl -s -X POST http://localhost:8092/graphql -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"query":"{ items { sku name quantityOnHand } }"}'
```

To call Catalog/Inventory's gRPC directly (no REST front door for them — same as Aspire),
`kubectl port-forward -n inventory-system svc/catalog-api 8080:80` and use `grpcurl` with the
`.proto` file directly, since reflection isn't enabled:

```
grpcurl -plaintext -H "authorization: Bearer $TOKEN" \
  -proto src/Shared/Grpc.Contracts/Protos/catalog.proto -import-path src/Shared/Grpc.Contracts/Protos \
  localhost:8080 catalog.CatalogGrpcService/ListItems
```

## Notes / deliberate simplifications

- **Each service has its own Postgres instance** (not shared, unlike Aspire's local setup) —
  full storage isolation, at the cost of three small containers. See `docs/architecture.md`.
- Postgres/Mongo are plain `Deployment`s + `PersistentVolumeClaim`s, not `StatefulSet`s. Right
  call for one instance, no replication — same as how Aspire runs them for local dev.
  RabbitMQ/Redis have no PVC at all — losing queued messages/cache on a restart is an accepted
  tradeoff, same reasoning `AppHost.cs` documents for Aspire's own RabbitMQ.
- `ASPNETCORE_ENVIRONMENT=Development` is set everywhere so `/health`/`/alive` (used by the
  probes), the startup EF migrations, and Staff.Api's seeded dev admin all stay active — same
  dev-only gate as running locally.
- Catalog.Api/Inventory.Api (the two gRPC-hosting services) each run **two** Kestrel endpoints:
  an HTTP/2-only one for gRPC traffic, a plain HTTP/1.1 one for the probes — see the Kestrel
  entry in `TECH_DEBT.md` for why one port can't do both without TLS.
- Linkerd's mTLS is real but invisible to the application — every gRPC client still needs
  `UnsafeUseInsecureChannelCallCredentials = true` permanently, mesh or no mesh, since Linkerd
  encrypts at the network layer without the app ever seeing HTTPS. Verified by testing — see
  TECH_DEBT.md.
- Secrets here use literal local-dev-only values, same convention as `AppHost.cs`'s pinned
  parameters — never do this for a real secret; a real cluster would use something like Sealed
  Secrets or an external secret store instead of plaintext-equivalent YAML.
