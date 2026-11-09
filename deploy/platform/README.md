# platform

Namespace and aggregate overlay. Owner: Ali.

`kubectl apply -k deploy/platform` deploys every lane into `team-backstage` on cluster `backstage` (Radar id `Wa7aYihloY4`). The namespace was provisioned for the event, so the overlay sets it but does not create it.

The overlay currently includes `../badge` only. Each owner adds a `kustomization.yaml` in their own directory (`deploy/incident`, `deploy/web`, `deploy/dash0`) and tells Ali, who adds it to `resources`. Tell Ali about any cluster prerequisite or changed reference.
