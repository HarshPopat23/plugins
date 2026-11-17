import { Datasource, query, requestPath, Search } from './loki';

export const CONTEXT_KINDS = [
  'Pod',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'Namespace',
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];
export interface ResourceContext {
  kind: ContextKind;
  namespace: string;
  name: string;
  uid?: string;
}
export interface ContextResource {
  kind?: string;
  cluster?: string;
  jsonData?: {
    kind?: string;
    apiVersion?: string;
    metadata?: { name?: string; namespace?: string; uid?: string };
  };
}

// Use only the selected object's metadata, never a live Pod list or name prefix.
export function resourceContext(resource: ContextResource | null): ResourceContext | null {
  const data = resource?.jsonData;
  const kind = data?.kind || resource?.kind;
  const expectedVersion =
    kind === 'Pod' || kind === 'Namespace' ? 'v1' : kind === 'Job' ? 'batch/v1' : 'apps/v1';
  if (!CONTEXT_KINDS.includes(kind as ContextKind) || data?.apiVersion !== expectedVersion)
    return null;
  const metadata = data.metadata;
  if (!metadata?.name || (kind !== 'Namespace' && !metadata.namespace)) return null;
  return {
    kind: kind as ContextKind,
    name: metadata.name,
    namespace: kind === 'Namespace' ? metadata.name : metadata.namespace!,
    uid: metadata.uid,
  };
}

export function contextQuery(context: ResourceContext): string {
  const params = new URLSearchParams({
    kind: context.kind,
    namespace: context.namespace,
    name: context.name,
  });
  if (context.uid) params.set('uid', context.uid);
  return params.toString();
}

export function parseContext(search: string): ResourceContext | undefined {
  const params = new URLSearchParams(search);
  if (!['kind', 'namespace', 'name', 'uid'].some(key => params.has(key))) return undefined;
  const kind = params.get('kind') as ContextKind;
  const namespace = params.get('namespace') || '';
  const name = params.get('name') || '';
  if (
    !CONTEXT_KINDS.includes(kind) ||
    !namespace ||
    !name ||
    (kind === 'Namespace' && namespace !== name)
  )
    throw new Error(
      'Invalid historical resource context. Open standalone search to choose filters explicitly.'
    );
  return { kind, namespace, name, uid: params.get('uid') || undefined };
}

export function contextFilters(context: ResourceContext | undefined, config: Datasource) {
  return {
    namespace: context?.namespace || '',
    pod: context?.kind === 'Pod' ? context.name : '',
    workloadKind: context && !['Pod', 'Namespace'].includes(context.kind) ? context.kind : '',
    workloadName: context && !['Pod', 'Namespace'].includes(context.kind) ? context.name : '',
    resourceUid:
      context &&
      context.kind !== 'Namespace' &&
      (context.kind === 'Pod' ? config.podUidLabel : config.workloadUidLabel)
        ? context.uid || ''
        : '',
  };
}

export function identityScope(
  search: Pick<Search, 'namespace' | 'pod' | 'workloadKind' | 'workloadName' | 'resourceUid'>
): string {
  if (search.resourceUid)
    return 'UID scope: only logs recorded with this resource UID are included. Logs collected before UID enrichment are excluded.';
  if (search.pod || search.workloadName)
    return 'Name scope: includes retained logs for every resource with this name and namespace in the selected time window, including deleted and recreated instances. Workload labels must record top-level ownership; name prefixes are not ownership evidence.';
  return 'Namespace scope: includes matching retained logs across this namespace, including deleted resources. Namespace names may be reused; this is not an authorization boundary.';
}

export interface TimeSelection {
  range: string;
  start: string;
  end: string;
}
const TIME_KEY = 'headlamp.loki.time.v1';
const initialTime = { range: '60', start: '', end: '' };
export function readTime(cluster: string): TimeSelection {
  try {
    const value = JSON.parse(sessionStorage.getItem(TIME_KEY) || '{}')[cluster];
    if (
      value &&
      ['15', '60', '1440', 'absolute'].includes(value.range) &&
      typeof value.start === 'string' &&
      typeof value.end === 'string'
    )
      return value;
  } catch {
    /* unavailable storage uses a fresh selection */
  }
  return { ...initialTime };
}
export function saveTime(cluster: string, time: TimeSelection) {
  try {
    const all = JSON.parse(sessionStorage.getItem(TIME_KEY) || '{}');
    sessionStorage.setItem(TIME_KEY, JSON.stringify({ ...all, [cluster]: time }));
  } catch {
    /* A storage failure must not prevent a query. */
  }
}
export function rememberWindow(cluster: string, search: Search) {
  saveTime(cluster, {
    range: 'absolute',
    start: new Date(search.start).toISOString(),
    end: new Date(search.end).toISOString(),
  });
}

// Validate before saving as well as when constructing an external link.
export function grafanaBaseURL(config: Datasource): URL | undefined {
  if (!config.grafanaUrl && !config.grafanaDatasourceUid && !config.grafanaOrgId) return undefined;
  if (!config.grafanaUrl || !config.grafanaDatasourceUid?.trim())
    throw new Error('Configure both the Grafana base URL and Loki datasource UID.');
  const url = new URL(config.grafanaUrl);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use an HTTP(S) Grafana base URL without credentials, query parameters or a fragment.'
    );
  if (config.grafanaOrgId && !/^[1-9]\d*$/.test(config.grafanaOrgId))
    throw new Error('Grafana organization ID must be a positive integer.');
  return url;
}

// Grafana Explore schemaVersion=1, using the exact successful query/window.
export function grafanaExploreURL(
  config: Datasource,
  search: Search,
  limit: number
): string | undefined {
  const url = grafanaBaseURL(config);
  if (!url) return undefined;
  requestPath('validation', config, search, limit);
  const datasource = { type: 'loki', uid: config.grafanaDatasourceUid };
  url.pathname = url.pathname.replace(/\/$/, '') + '/explore';
  url.searchParams.set('schemaVersion', '1');
  url.searchParams.set(
    'panes',
    JSON.stringify({
      logs: {
        datasource: datasource.uid,
        queries: [
          {
            refId: 'A',
            datasource,
            expr: query(config, search),
            queryType: 'range',
            editorMode: 'code',
            maxLines: limit,
          },
        ],
        range: { from: String(search.start), to: String(search.end) },
      },
    })
  );
  if (config.grafanaOrgId) url.searchParams.set('orgId', config.grafanaOrgId);
  return url.toString();
}
