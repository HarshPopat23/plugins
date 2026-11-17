# Contextual history acceptance procedure

These are reproducible instructions, **not execution evidence**. Use a disposable
cluster and record its context explicitly on every command. The existing fixture
is unauthenticated and has no network isolation; it is not production security.
No operation below requires deleting or replacing your kubeconfig.

Deploy `evaluation.yaml` as described in README.md. When updating an existing
fixture, restart the Alloy Deployment after changing its ConfigMap and wait for
readiness. Apply `contextual-workloads.yaml` in the same disposable cluster. Its
four workloads emit current-time `CONTEXT_HISTORY` markers every two seconds for
20 minutes. The Job intentionally stays alive long enough for discovery.

The Alloy relabel rules copy these explicit Pod-template labels:

| Pod metadata                          | Indexed Loki label | Meaning                       |
| ------------------------------------- | ------------------ | ----------------------------- |
| `headlamp.dev/history-kind`           | `workload_kind`    | Exact top-level workload kind |
| `headlamp.dev/history-name`           | `workload_name`    | Exact top-level workload name |
| `headlamp.dev/history-uid` (optional) | `workload_uid`     | Exact top-level workload UID  |
| Kubernetes Pod UID                    | `pod_uid`          | Exact Pod instance            |

Configure stored cluster `evaluation-a`, workload kind/name mappings
`workload_kind` / `workload_name`. Optionally map Pod UID to `pod_uid`.
The template labels are deliberately assigned for these fixtures. In production,
a collector/enrichment pipeline must record correct ownership before logs are
ingested. Arbitrary Pod labels are not trusted authorization evidence. No current
Pod list is used to constrain a historical query. Earlier unlabeled entries are
excluded by workload queries; namespace search remains available explicitly.

Before each experiment, record: tested commit and plugin tarball hash, cluster
context/server identity (redact credentials), Kubernetes/Headlamp/Loki/Alloy image
versions and readiness, exact UTC bounds, request URL/query, raw Loki streams,
rendered rows and unique markers. Confirm ingestion before deleting anything.
Take screenshots only after assertions establish the expected visible result.

## Rollout: retain both generations

1. Wait for every fixture workload to become ready; inspect Alloy health and Loki
   responses. Open the Deployment's **Historical logs** action. Check namespace
   `default`, kind `Deployment`, name `history-deployment`, generated LogQL and
   visible **Name scope**. Verify the existing Kubernetes Logs action still works
   on a Pod. Record the original Pod names/UIDs and an ingested `generation=v1`
   marker from each Pod before the rollout.
2. Change the Deployment template, replacing every Pod:
   ```sh
   kubectl --context CONTEXT set env deployment/history-deployment GENERATION=v2
   kubectl --context CONTEXT rollout status deployment/history-deployment
   ```
   Record new names/UIDs and prove none of the old Pods remain. Wait for a unique
   `generation=v2` marker from each replacement Pod to appear in Loki.
3. Search an absolute window covering both generations through the workload
   action. Assert old and new markers/Pod identities occur in the returned Loki
   streams and rendered results. The query must contain workload kind/name and
   **no list of currently running Pod names**. Record limits/truncation honestly.

## Deleted Job: standalone recovery

Wait until a unique `history-job` marker is confirmed in Loki, record its Job UID,
Pod UID and timestamp, then delete only that fixture Job:

```sh
kubectl --context CONTEXT delete job history-job --wait=true
kubectl --context CONTEXT get job history-job
```

The second command must report NotFound. From standalone Historical logs, select
namespace `default`, kind `Job`, name `history-job`, and an absolute window around
the recorded marker. Assert the marker appears after Job deletion. No live object
or Pod discovery should be needed. Record child Pod deletion separately if claimed.

## Same-name recreation and identity

With UID mappings blank, deleting and recreating a workload under the same
namespace/kind/name intentionally returns both incarnations within the window.
Emit distinct markers (`GENERATION=v1` / `v2`), record the different workload UIDs,
and verify both markers and the **Name scope** explanation.

For exact identity evaluation, use a fresh Deployment with replicas initially 0.
After creating the workload, read its UID and patch **that exact UID** into its
Pod-template `headlamp.dev/history-uid` label before scaling up. Repeat this for
its same-name replacement with a new UID. Configure `workloadUidLabel` as
`workload_uid`. The contextual action should prefill the current workload UID;
manually entering the deleted UID in standalone search should return only its
recorded markers. Clearing the UID should return both. A workload UID is stable
through a rollout but changes after delete/recreate. Never use a Pod UID as the
workload UID, or retroactively claim enrichment for earlier entries.

## Namespace, missing mappings and time continuity

Open each supported resource detail page (Pod, Deployment, StatefulSet, DaemonSet,
Job and Namespace). Confirm its action, prefilled filters, visible generated query
and retained original actions. Remove workload mappings: workload search must be
blocked with an explanation until configured, or explicitly broadened using
**Search namespace instead**. Namespace and Pod-name searches still work.

Select an absolute range and navigate between contextual and standalone search.
Assert unchanged bounds. After a relative search, navigation should restore its
frozen successful absolute bounds. Switch clusters and assert time/config state
is isolated; switch context during an in-flight request and ensure stale results
cannot populate the new page.

## Grafana: real receiver verification

Configure an actual Grafana base URL, its Loki datasource UID and (if needed)
organization ID. Independently establish that datasource addresses the same Loki
store/tenant. Execute a Headlamp search; inspect **Open in Grafana** to verify the
Explore panes datasource, exact LogQL and absolute epoch-ms range match the
successful Kubernetes proxy request (whose bounds use nanoseconds).
Open the link, authenticate normally, and assert the selected datasource, filters,
range and expected unique markers in Grafana. Preserve its received URL and query
request with credentials redacted. URL unit tests alone do not establish that
Grafana received or executed the intended query.

Cleanup only created fixture resources using their manifests and explicit context.
Preserve any unrelated contexts, credentials and kubeconfig entries.
