# Contextual history validation

This is the stacked follow-up to upstream
[PR #1500](https://github.com/headlamp-k8s/plugins/pull/1500), based on
`02cbc1dbaf9c08b65f1616f2e92f75f76b5181f0` (`feat/loki-historical-logs`).
The comparison against that branch contains only contextual history changes.
Keep the follow-up draft until the outstanding live acceptance checks are recorded.

## Executed automated checks

Checked on Linux x64 with Node v24.22.1, npm 11.9.0 and the locked dependencies.
Commands below run from `loki/`, except the repository-root diff check.

| Check                              | Result                              | Evidence scope                                                                                                                                                       |
| ---------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                         | PASS: 5 files, 88 tests             | Unit and jsdom component tests; Kubernetes/Loki calls are mocked                                                                                                     |
| `npm run tsc`                      | PASS: exit 0                        | Types against the installed plugin SDK                                                                                                                               |
| `npm run lint`                     | PASS: exit 0                        | Project ESLint with zero permitted warnings                                                                                                                          |
| `npm run build`                    | PASS: exit 0                        | Production plugin bundle                                                                                                                                             |
| `npm run package`                  | PASS: exit 0                        | Plugin tarball generation; installation in Headlamp not established                                                                                                  |
| `git diff --check`                 | PASS: exit 0                        | Whitespace validation                                                                                                                                                |
| YAML and fixture checks            | PASS                                | 16 evaluation + 4 contextual documents parsed without errors; workload template kind/name labels match their declared resources; emitter shell commands pass `sh -n` |
| Standard `npm run storybook-build` | FAILED command; environment BLOCKED | Node `uv_interface_addresses` fails while Storybook enumerates OS interfaces, before compiling stories                                                               |
| Adapted Storybook build below      | PASS: exit 0                        | Static compilation with a build-only OS-interface fallback; webpack asset-size warnings remain                                                                       |
| Chromium story smoke               | BLOCKED                             | Browser aborts before any page loads: `process_singleton_posix.cc` socket operation not permitted                                                                    |

A packaging recheck initially refused to overwrite its existing generated archive.
That earlier archive was preserved separately, then `npm run package` succeeded
against the final bundle. Final tarball SHA-256:
`839e7cc084ea00998baa6fc613c30fc213a9dafd174acb17f552fbc3bbb80b9f`.

The successful Storybook command was **not** the unchanged standard command.
The exact adaptation is a temporary Node CommonJS preload containing:

```js
require('node:os').networkInterfaces = () => ({});
```

Then run:

```sh
NODE_OPTIONS=--require=/absolute/path/to/preload.cjs npm run storybook-build
```

This bypasses host interface discovery for static compilation only. No plugin
source or dependencies were patched. No browser screenshot or Headlamp Desktop
smoke-test success is claimed. Raw local check output and process exit codes were
captured separately from this source-level summary.

## What the automated evidence establishes

- Additive header actions for Pod, Deployment, StatefulSet, DaemonSet, Job and
  Namespace; existing action entries, including native Logs, remain in the array.
  Routing uses the SDK route builder and encodes the selected object's metadata.
- Exact, escaped cluster/namespace/Pod/workload/UID filters. No live Pod discovery,
  Pod-name regular expression or ReplicaSet-name inference constructs ownership.
- Missing or malformed mappings block search; namespace broadening requires an
  explicit action. Unconfigured and unsupported-mapping stories compile.
- A simulated rollout response includes both old/deleted and new Pod generations.
  Standalone Job queries need no live Job object. Name reuse and recorded UID
  selection are tested as query contracts, not as executed Kubernetes lifecycles.
- A successful window is restored as absolute bounds across contextual and
  standalone navigation. Cluster time state is isolated. Context changes abort
  pending work, and late responses do not populate the next context.
- Grafana Explore URL tests decode the payload and compare datasource UID,
  generated LogQL, request limit and epoch-ms bounds against Headlamp's request.
  Unsafe credential-bearing base URLs are rejected before configuration is saved.
  These tests do not prove receipt, authentication or execution by a Grafana server.

## Outstanding acceptance evidence

| Experiment                                                            | Status  | Required next evidence                                                                                          |
| --------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| Replace every Pod during a real rollout and retrieve both generations | BLOCKED | Real cluster, collector health, old/new Pod UIDs, exact ingested markers, request/response and rendered results |
| Delete an entire Job and retrieve its logs from standalone search     | BLOCKED | Job UID/deletion confirmation and the same marker returned afterward                                            |
| Recreate the same workload name                                       | BLOCKED | Distinct UIDs/markers; name-scoped union versus correctly enriched UID-specific results                         |
| Verify Grafana receives the query                                     | BLOCKED | Real Grafana datasource selection, received request, exact range/LogQL and marker results                       |
| Confirm native Logs and contextual actions in installed Headlamp      | BLOCKED | Real Headlamp browser run; additive action DOM tests alone are insufficient                                     |

This host has no `docker`, `kind` or `kubectl` executable, and no live Grafana
endpoint is configured. These experiments were not run. Follow
[test-files/CONTEXTUAL.md](test-files/CONTEXTUAL.md) on a disposable cluster,
retain the original evidence, and record each check separately. Do not delete an
entire kubeconfig during cleanup.

## Dependency and review plan

The draft targets `feat/loki-historical-logs` in the fork; the parent branch is
unchanged. After upstream PR #1500 merges, rebase the contextual commits onto the
updated upstream `main` and retarget the fork draft to `main`. GitHub cannot
change an existing PR's base repository: submitting the rebased changes to
`headlamp-k8s/plugins` then requires an upstream PR targeting its `main` branch.
