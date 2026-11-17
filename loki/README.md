# Loki historical logs (experimental)

Read-only historical search with workload and namespace entry points, including
logs from deleted Pods **if
collected and still retained in Loki**. It never lists live Pods to build a query.
No collection, storage, retention management, live tail or Grafana embedding.

## Supported authorization model

The first version supports an in-cluster HTTP Loki gateway, reached through the
Kubernetes API Service proxy using the signed-in user's Kubernetes credentials.
Configure the exact namespace, Service and port in the page's datasource section.
Loki queries accept no arbitrary external URLs, credentials or tenant headers.
An optional Grafana base URL is used only to build an external Explore link.

Grant Service proxy permission **only to users allowed to query all logs in the
gateway's configured tenant**. Kubernetes namespace filters in this UI are NOT
authorization. The gateway must use a fixed trusted tenant; do not trust tenant
headers supplied by a client. Do not grant direct access to the underlying Loki
service or a more privileged gateway. Kubernetes access control must also deny
unintended proxy/port-forward/exec routes. Restrict networking and gateway access
in a production deployment. This plugin does not enforce per-namespace log access.

The checked-in example uses a single tenant and a gateway that exposes only
query_range. It is a local evaluation setup, not a production security deployment.
For multi-user, multi-tenant installations, first agree and test the gateway's
identity and authorization policy. Hosted Loki/Grafana Cloud is not supported.

## Installation and development

From this directory: `npm ci`, `npm start`, and load the development plugin in
Headlamp using its Plugin Development Mode. For checks run `npm test`,
`npm run tsc`, `npm run lint`, `npm run build`, and
`npm run storybook-build`. Run `npm run package` to produce a local plugin archive.
This source is not yet a published Artifact Hub release.

## Search

Open **Historical logs**. Expand datasource configuration, enter the Service
coordinates and the exact cluster label value stored by your collector; save and
test. Settings are scoped to the Headlamp cluster context name and contain no
secrets. Query fields are literal values, not raw LogQL. An exact namespace is
required; Pod and container are optional. Deleted names can be entered manually.
This initial version supports indexed-label mappings only, not structured metadata.
It does not infer historical ownership from current Pods, selectors or name prefixes.

Relative windows: 15 minutes, one hour, 24 hours. Absolute timestamps must include
a timezone. Maximum range: seven days. Queries start at 200 entries. **Load older**
repeats the same frozen window with a doubled limit (up to 2,000), replacing the
result rather than deduplicating messages or advancing a timestamp cursor.
This preserves real repeated lines and equal timestamps within each response.
It is bounded prefix expansion, not a guarantee of complete export. At a full
limit, results may be truncated even within a timestamp; narrow the range.
No total count is inferred. At most 2,000 rows are rendered. Each click issues one
request. Configuration/filter changes, cancel, and cluster unmount invalidate work.
Empty results are distinct from authorization, parsing, transport and rate errors.
Use narrow incident windows to limit repeated server scans and browser memory.

## Reproducible local evaluation

See [test-files/README.md](test-files/README.md) for Loki, Alloy, the gateway,
RBAC, and an emitter. The collector records indexed labels `cluster`,
`namespace`, `pod`, `container`. For a second cluster, replace the static
collector cluster value with a distinct identifier and configure that context's
datasource accordingly. Current live Pod names never constrain historical lookup.

## Verification status

Automated query/response and UI regressions are included. Live collector ingestion,
Pod deletion recovery, two-cluster isolation, deployed gateway denial and browser
smoke verification must be recorded separately; unit mocks do not establish them.

## Contextual workload search

Pod, Deployment, StatefulSet, DaemonSet, Job and Namespace detail headers include
**Historical logs** alongside existing actions. The Kubernetes **Logs** action is
unchanged. Context is encoded in the historical page URL and remains editable;
opening it never automatically issues a query. The generated LogQL and identity
scope are visible before searching. Standalone search also accepts workload kind,
name and optional UID, so deleting the Kubernetes object does not remove access
to previously collected logs.

The original indexed-label contract (`cluster`, `namespace`, `pod`, `container`)
still supports Pod and namespace history. Workload search additionally requires
configured **recorded workload kind and name labels**. Those values must describe
the top-level owner (for example Deployment, not its ReplicaSet). The collector
must enrich logs at ingestion time; this plugin does not traverse live Pods or
infer historical owners. Missing mappings disable workload search and explain why.
**Search namespace instead** explicitly removes ownership constraints; it never
silently broadens an unavailable workload mapping. Existing logs without the new
labels cannot be recovered by adding mappings later.

| Filter               | Indexed label mapping              | Identity behavior                                                        |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Pod name             | Existing Pod label                 | All instances with that namespace/name in the window                     |
| Workload kind + name | Optional workload kind/name labels | All generations and same-name recreations of that kind                   |
| Resource UID         | Optional Pod or workload UID label | Only entries recorded with the exact UID; older unenriched logs excluded |
| Namespace            | Existing namespace label           | All matching retained logs, including reused namespace names             |

UID filtering is prefilled only when the matching UID mapping and object UID are
available. Otherwise the visible **Name scope** warning applies. Workload UIDs
must identify the top-level workload, not a Pod or ReplicaSet. Label accuracy is a
collector/operator contract, not proof of ownership or an authorization boundary.
UID labels increase stream cardinality; configure them deliberately.

Time selections are remembered per Headlamp cluster in this browser tab. After a
successful search, navigation to another contextual or standalone search restores
the exact absolute window, preventing a rolling relative range from shifting an
incident investigation. Changing the time selection starts a new window.

To enable **Open in Grafana**, save a Grafana HTTP(S) base URL and Loki datasource
UID; an organization ID is optional. Use the datasource representing the same
Loki tenant/cluster as Headlamp. No Grafana credentials are stored. The link is
shown after a successful query and carries that exact LogQL, absolute epoch-ms
range, datasource UID and requested row limit using Grafana Explore's
[`schemaVersion=1` panes format](https://grafana.com/docs/grafana/latest/visualizations/explore/get-started-with-explore/#generate-explore-urls-from-external-tools). Base paths are supported. Authentication and
Grafana permissions remain Grafana's responsibility; hosted Loki is not made
queryable through Headlamp by this link. Editing filters invalidates the link.

See [test-files/CONTEXTUAL.md](test-files/CONTEXTUAL.md) for explicit-label fixtures
and live rollout, deletion, recreation and Grafana acceptance procedures.
See [CONTEXTUAL_VALIDATION.md](CONTEXTUAL_VALIDATION.md) for the evidence boundary.
