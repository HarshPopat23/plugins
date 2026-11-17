import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { CONTEXT_KINDS, contextQuery, ResourceContext } from '../api/context';
import { defaults } from '../api/loki';
import SearchView, { HistoricalSearch } from './SearchView';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { clusterRequest: request },
  K8s: { useCluster: () => 'a' },
  Router: { createRouteURL: () => '/c/a/loki/history' },
}));
const config = {
  ...defaults,
  clusterValue: 'evaluation-a',
  workloadKindLabel: 'workload_kind',
  workloadNameLabel: 'workload_name',
};
const context: ResourceContext = {
  kind: 'Deployment',
  namespace: 'shop',
  name: 'orders',
  uid: 'deployment-uid',
};
function configure(extra = {}) {
  localStorage.setItem(
    'headlamp.loki.datasources.v1',
    JSON.stringify({ a: { ...config, ...extra } })
  );
}
function params() {
  return new URL(request.mock.calls[0][0], 'https://headlamp.test').searchParams;
}
beforeEach(() => {
  request.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  configure();
  request.mockResolvedValue({ status: 'success', data: { resultType: 'streams', result: [] } });
});
it.each(CONTEXT_KINDS)(
  'prefills %s filters without any discovery request or automatic search',
  kind => {
    render(<HistoricalSearch cluster="a" context={{ ...context, kind }} />);
    expect((screen.getByLabelText(/Exact namespace/) as HTMLInputElement).value).toBe('shop');
    const generated = screen.getByLabelText('Generated LogQL').textContent!;
    if (kind === 'Pod') expect(generated).toContain('pod="orders"');
    else if (kind !== 'Namespace') {
      expect(generated).toContain(`workload_kind="${kind}"`);
      expect(generated).toContain('workload_name="orders"');
      expect(generated).not.toContain('pod=');
    } else expect(generated).not.toContain('workload_');
    expect(request).not.toHaveBeenCalled();
  }
);
it('blocks unavailable ownership mappings and requires an explicit namespace fallback', () => {
  configure({ workloadKindLabel: '', workloadNameLabel: '' });
  render(<HistoricalSearch cluster="a" context={context} />);
  expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/No historical ownership is inferred/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search namespace instead' }));
  expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(
    false
  );
  expect(screen.getByLabelText('Generated LogQL').textContent).not.toContain('workload_name');
  expect(screen.getByText(/Namespace scope/)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
it('shows missing datasource configuration without issuing a request', () => {
  localStorage.clear();
  render(<HistoricalSearch cluster="a" context={context} />);
  expect(screen.getByText(/Configure the exact stored cluster label value/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});
it('retrieves both simulated rollout generations using recorded ownership rather than current Pods', async () => {
  const timestamp = String(BigInt(Date.now()) * BigInt(1000000));
  request.mockResolvedValue({
    status: 'success',
    data: {
      resultType: 'streams',
      result: ['old-deleted-pod', 'new-pod'].map(pod => ({
        stream: { pod, workload_kind: 'Deployment', workload_name: 'orders' },
        values: [[timestamp, 'marker-' + pod]],
      })),
    },
  });
  render(<HistoricalSearch cluster="a" context={context} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('marker-old-deleted-pod');
  expect(screen.getByText('marker-new-pod')).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
  expect(params().get('query')).toContain('workload_name="orders"');
  expect(params().get('query')).not.toContain('pod=');
});
it('keeps a deleted Job searchable from standalone filters and shares the same Grafana window', async () => {
  configure({ grafanaUrl: 'https://grafana.test', grafanaDatasourceUid: 'loki-uid' });
  render(<HistoricalSearch cluster="a" />);
  fireEvent.change(screen.getByLabelText(/Exact namespace/), { target: { value: 'shop' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Workload kind (optional)' }));
  fireEvent.click(screen.getByRole('option', { name: 'Job' }));
  fireEvent.change(screen.getByLabelText(/Exact workload name/), {
    target: { value: 'deleted-job' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const link = await screen.findByRole('link', { name: 'Open in Grafana' });
  const pane = JSON.parse(new URL(link.getAttribute('href')!).searchParams.get('panes')!).logs;
  expect(pane.queries[0].expr).toBe(params().get('query'));
  expect(pane.queries[0].expr).toContain('workload_name="deleted-job"');
  expect(BigInt(pane.range.from) * BigInt(1000000)).toBe(BigInt(params().get('start')!));
  expect(BigInt(pane.range.to) * BigInt(1000000)).toBe(BigInt(params().get('end')!));
  fireEvent.change(screen.getByLabelText('Log text contains'), { target: { value: 'other' } });
  expect(screen.queryByRole('link', { name: 'Open in Grafana' })).toBeNull();
});
it('preserves the successful absolute window when opening standalone search', async () => {
  render(
    <MemoryRouter initialEntries={['/c/a/loki/history?' + contextQuery(context)]}>
      <Route path="/c/a/loki/history">
        <SearchView />
      </Route>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText(/No matching retained logs/);
  const from = new Date(Number(BigInt(params().get('start')!) / BigInt(1000000))).toISOString();
  fireEvent.click(screen.getByRole('button', { name: 'Open standalone search' }));
  expect((screen.getByLabelText('Start (ISO 8601 with timezone)') as HTMLInputElement).value).toBe(
    from
  );
  expect(screen.getByLabelText('Generated LogQL').textContent).toContain('Unavailable');
});
it('rejects malformed context rather than broadening silently', () => {
  render(
    <MemoryRouter initialEntries={['/c/a/loki/history?kind=Unknown&name=x&namespace=shop']}>
      <SearchView />
    </MemoryRouter>
  );
  expect(screen.getByText(/Invalid historical resource context/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});
it('aborts a pending contextual request when the context changes and ignores late results', async () => {
  let release!: (value: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise(resolve => {
        release = resolve;
      })
  );
  const view = render(<HistoricalSearch key="orders" cluster="a" context={context} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const signal = request.mock.calls[0][1].signal;
  view.rerender(
    <HistoricalSearch key="other" cluster="a" context={{ ...context, name: 'other' }} />
  );
  expect(signal.aborted).toBe(true);
  await act(async () =>
    release({
      status: 'success',
      data: { resultType: 'streams', result: [{ stream: {}, values: [['1', 'STALE']] }] },
    })
  );
  expect(screen.queryByText('STALE')).toBeNull();
  expect(screen.getByLabelText('Generated LogQL').textContent).toContain('workload_name="other"');
});

it('rejects credential-bearing Grafana settings before persisting datasource changes', () => {
  const previous = localStorage.getItem('headlamp.loki.datasources.v1');
  render(<HistoricalSearch cluster="a" />);
  fireEvent.click(screen.getByText('Datasource configuration'));
  fireEvent.change(screen.getByLabelText('Grafana base URL (optional)'), {
    target: { value: 'https://user:password@grafana.test' },
  });
  fireEvent.change(screen.getByLabelText('Grafana Loki datasource UID (optional)'), {
    target: { value: 'loki-prod' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save datasource' }));
  expect(screen.getByText(/without credentials, query parameters or a fragment/)).toBeTruthy();
  expect(localStorage.getItem('headlamp.loki.datasources.v1')).toBe(previous);
});
