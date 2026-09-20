# Kubernetes manifests (Step 10 proof of concept)

Local-only, learning-focused Kubernetes manifests for this project, run against a `k3d` cluster
(k3s packaged to run as Docker containers — see `docs/architecture.md`). This is **not** meant
to replace Aspire for day-to-day development; Aspire's `AppHost.cs` is still the fast inner loop.
This is for learning/rehearsing how the same services run on real Kubernetes, one step at a time.

Currently covers only `catalog-api` + its own Postgres, as a proof of concept before every
service gets the same treatment.

## Prerequisites

- `k3d` cluster running: `k3d cluster create inventory-system --wait`
- `kubectl` pointed at it (k3d does this automatically): `kubectl config current-context` should
  print `k3d-inventory-system`

## Build and load the image

k3d's nodes are separate containerd instances from Docker Desktop's own image store — an image
built with `docker build`/`dotnet publish` locally is invisible to the cluster until you import
it explicitly (no registry needed for local dev):

```
dotnet publish src/Services/Catalog/Catalog.Api -c Release -t:PublishContainer `
  -p:ContainerRepository=catalog-api -p:ContainerImageTag=dev --os linux --arch x64

k3d image import catalog-api:dev -c inventory-system
```

Re-run both after every code change — there's no volume-mount hot reload here like Aspire's
`dotnet run`; that's the actual cost of the "closer to production" tradeoff.

## Apply

```
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/catalog-api.yaml
```

## Verify

```
kubectl get pods -n inventory-system
kubectl port-forward -n inventory-system svc/catalog-api 8080:80
```

Then, in another shell, from the repo root (needs `grpcurl`):

```
grpcurl -plaintext -proto src/Shared/Grpc.Contracts/Protos/catalog.proto \
  -import-path src/Shared/Grpc.Contracts/Protos \
  localhost:8080 catalog.CatalogGrpcService/ListItems
```

(Every RPC requires a JWT — see Program.cs/architecture.md — so an unauthenticated `ListItems`
call is expected to fail with `PERMISSION_DENIED`/`UNAUTHENTICATED` here; that failure mode
itself confirms auth is enforced identically to Aspire. There's no Staff.Api in the cluster yet
to mint a real token against.)

## Notes / deliberate simplifications for this POC

- Postgres is a plain `Deployment` + `PersistentVolumeClaim`, not a `StatefulSet`. That's the
  right call for how Aspire runs it too (one instance, no replication) — a `StatefulSet` earns
  its keep once you actually need multiple identity-bearing replicas.
- `ASPNETCORE_ENVIRONMENT=Development` is set so `/health`/`/alive` (used by the probes) and the
  startup `Database.Migrate()` call both stay active — same dev-only gate as running locally.
- `Kestrel__EndpointDefaults__Protocols=Http1AndHttp2` is required for gRPC to work at all here:
  without TLS, Kestrel's plain-HTTP endpoint defaults to HTTP/1.1 only, and gRPC hard-requires
  HTTP/2. This is the cleartext-HTTP/2 ("h2c") pattern real clusters use for internal traffic,
  with TLS terminated at an ingress instead — not a shortcut specific to this being local.
- Secrets here use literal local-dev-only values, same convention as `AppHost.cs`'s pinned
  `postgres-password` parameter — never do this for a real secret; a real cluster would use
  something like Sealed Secrets or an external secret store instead of plaintext-equivalent YAML.
