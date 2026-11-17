import { beforeEach, expect, it } from 'vitest';
import {
  CONTEXT_KINDS,
  contextFilters,
  contextQuery,
  grafanaExploreURL,
  identityScope,
  parseContext,
  readTime,
  rememberWindow,
  resourceContext,
  saveTime,
} from './context';
import { defaults, query, requestPath, Search, validateDatasource } from './loki';

const config = {
  ...defaults,
  clusterValue: 'evaluation-a',
  workloadKindLabel: 'workload_kind',
  workloadNameLabel: 'workload_name',
  workloadUidLabel: 'workload_uid',
  podUidLabel: 'pod_uid',
};
const search: Search = {
  namespace: 'shop',
  pod: '',
  container: '',
  text: 'incident "42"',
  start: 1700000000000,
  end: 1700003600000,
};
beforeEach(() => sessionStorage.clear());
it.each(CONTEXT_KINDS)('maps only built-in %s metadata without discovering current Pods', kind => {
  const apiVersion =
    kind === 'Namespace' || kind === 'Pod' ? 'v1' : kind === 'Job' ? 'batch/v1' : 'apps/v1';
  const context = resourceContext({
    jsonData: { kind, apiVersion, metadata: { name: 'orders', namespace: 'shop', uid: 'uid-1' } },
  })!;
  expect(context).toEqual({
    kind,
    name: 'orders',
    namespace: kind === 'Namespace' ? 'orders' : 'shop',
    uid: 'uid-1',
  });
  expect(parseContext('?' + contextQuery(context))).toEqual(context);
  const filters = contextFilters(context, config);
  expect(filters.pod).toBe(kind === 'Pod' ? 'orders' : '');
  expect(filters.workloadName).toBe(['Pod', 'Namespace'].includes(kind) ? '' : 'orders');
  expect(filters.resourceUid).toBe(kind === 'Namespace' ? '' : 'uid-1');
});
it('rejects custom kinds, spoofed API groups, incomplete objects and malformed context URLs', () => {
  expect(resourceContext(null)).toBeNull();
  for (const [kind, apiVersion] of [
    ['CronJob', 'batch/v1'],
    ['Deployment', 'example.com/v1'],
  ]) {
    expect(
      resourceContext({
        jsonData: { kind, apiVersion, metadata: { name: 'x', namespace: 'shop' } },
      })
    ).toBeNull();
  }
  expect(
    resourceContext({ jsonData: { kind: 'Pod', apiVersion: 'v1', metadata: { name: 'x' } } })
  ).toBeNull();
  expect(parseContext('')).toBeUndefined();
  for (const value of [
    '?uid=x',
    '?kind=Unknown&namespace=shop&name=x',
    '?kind=Namespace&namespace=shop&name=other',
  ])
    expect(() => parseContext(value)).toThrow(/Invalid historical resource context/);
});
it('encodes literal filters and makes missing ownership mappings an error', () => {
  const input = { ...search, workloadKind: 'Deployment', workloadName: 'orders".*' };
  expect(query(config, input)).toBe(
    '{cluster="evaluation-a",namespace="shop",workload_kind="Deployment",workload_name="orders\\".*"} |= "incident \\"42\\""'
  );
  expect(query(config, input)).not.toContain('pod=');
  expect(() => query({ ...defaults, clusterValue: 'a' }, input)).toThrow(
    /No historical ownership is inferred/
  );
  expect(() => query(config, { ...search, workloadKind: 'Deployment' })).toThrow(/both/);
  expect(() => query(config, { ...input, workloadKind: 'CronJob' })).toThrow(/Unsupported/);
  expect(() => query(config, { ...search, resourceUid: 'uid' })).toThrow(
    /requires a Pod or workload/
  );
});
it('keeps PR1 Pod searches compatible and rejects invalid or colliding optional label mappings', () => {
  const oldConfig = { ...defaults, clusterValue: 'a' };
  expect(query(oldConfig, { ...search, pod: 'deleted-pod' })).toContain('pod="deleted-pod"');
  expect(() => validateDatasource({ ...config, workloadNameLabel: 'pod' })).toThrow(/distinct/);
  expect(() => validateDatasource({ ...config, workloadNameLabel: 'not-a-label' })).toThrow(
    /Invalid Loki label/
  );
  expect(() => query(oldConfig, { ...search, pod: 'x', resourceUid: 'uid' })).toThrow(
    /recorded UID/
  );
});
it('documents name reuse and restricts UID searches to recorded identity', () => {
  const named = { ...search, workloadKind: 'Job', workloadName: 'nightly' };
  expect(identityScope(named)).toContain('deleted and recreated');
  expect(query(config, named)).not.toContain('workload_uid');
  expect(query(config, { ...named, resourceUid: 'old-uid' })).toContain('workload_uid="old-uid"');
  expect(query(config, { ...named, resourceUid: 'new-uid' })).not.toContain('old-uid');
  expect(identityScope({ ...named, resourceUid: 'old-uid' })).toContain(
    'before UID enrichment are excluded'
  );
});
it('preserves a frozen successful window across contextual and standalone navigation per cluster', () => {
  saveTime('a', { range: '15', start: '', end: '' });
  expect(readTime('a').range).toBe('15');
  rememberWindow('a', search);
  expect(readTime('a')).toEqual({
    range: 'absolute',
    start: new Date(search.start).toISOString(),
    end: new Date(search.end).toISOString(),
  });
  expect(readTime('b').range).toBe('60');
  sessionStorage.setItem('headlamp.loki.time.v1', 'invalid');
  expect(readTime('a').range).toBe('60');
});
it('encodes the exact Headlamp query, datasource and frozen epoch range for Grafana Explore', () => {
  const input = { ...search, workloadKind: 'Deployment', workloadName: 'orders' };
  const configured = {
    ...config,
    grafanaUrl: 'https://grafana.example.org/observability/',
    grafanaDatasourceUid: 'loki-prod',
    grafanaOrgId: '2',
  };
  const url = new URL(grafanaExploreURL(configured, input, 400)!);
  expect(url.pathname).toBe('/observability/explore');
  expect(url.searchParams.get('orgId')).toBe('2');
  expect(url.searchParams.get('schemaVersion')).toBe('1');
  const pane = JSON.parse(url.searchParams.get('panes')!).logs;
  expect(pane.datasource).toBe('loki-prod');
  expect(pane.queries[0]).toMatchObject({
    datasource: { type: 'loki', uid: 'loki-prod' },
    expr: query(config, input),
    maxLines: 400,
  });
  expect(pane.range).toEqual({ from: String(input.start), to: String(input.end) });
  const params = new URL(requestPath('a', config, input, 400), 'https://headlamp.test')
    .searchParams;
  expect(params.get('query')).toBe(pane.queries[0].expr);
  expect(params.get('start')).toBe(String(BigInt(input.start) * BigInt(1000000)));
  expect(params.get('end')).toBe(String(BigInt(input.end) * BigInt(1000000)));
});
it('keeps Grafana optional and rejects unsafe or incomplete settings', () => {
  expect(grafanaExploreURL(config, search, 200)).toBeUndefined();
  expect(() =>
    grafanaExploreURL({ ...config, grafanaUrl: 'https://grafana.test' }, search, 200)
  ).toThrow(/both/);
  for (const grafanaUrl of [
    'javascript:alert(1)',
    'https://user:password@grafana.test',
    'https://grafana.test?token=x',
    'https://grafana.test#fragment',
  ]) {
    expect(() =>
      grafanaExploreURL({ ...config, grafanaUrl, grafanaDatasourceUid: 'loki' }, search, 200)
    ).toThrow(/HTTP/);
  }
});
