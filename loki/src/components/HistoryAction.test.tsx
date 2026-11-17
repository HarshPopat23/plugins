import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/KubeObject';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { CONTEXT_KINDS, parseContext } from '../api/context';
import { historicalActions, registerHistoricalActions } from './HistoryAction';

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  registerDetailsViewHeaderActionsProcessor: register,
  Router: {
    createRouteURL: (_: string, { cluster }: { cluster: string }) =>
      '/c/' + encodeURIComponent(cluster) + '/loki/history',
  },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  ActionButton: ({ description, onClick }: { description: string; onClick: () => void }) => (
    <button onClick={onClick}>{description}</button>
  ),
}));
function Location() {
  const location = useLocation();
  return <output aria-label="Location">{location.pathname + location.search}</output>;
}
it.each(CONTEXT_KINDS)('appends a %s action while preserving the native Logs action', kind => {
  const native = { id: 'POD_LOGS', action: <button>Logs</button> };
  const actions = [native];
  const apiVersion = ['Pod', 'Namespace'].includes(kind)
    ? 'v1'
    : kind === 'Job'
    ? 'batch/v1'
    : 'apps/v1';
  const resource = {
    cluster: 'cluster a',
    jsonData: { kind, apiVersion, metadata: { namespace: 'shop', name: 'orders', uid: 'uid-1' } },
  } as KubeObject;
  const result = historicalActions(resource, actions);
  expect(actions).toEqual([native]);
  expect(result[0]).toBe(native);
  expect(result).toHaveLength(2);
  expect(historicalActions(resource, result)).toBe(result);
  render(
    <MemoryRouter>
      {result.map(action => (
        <React.Fragment key={action.id}>
          {React.isValidElement(action.action) ? action.action : null}
        </React.Fragment>
      ))}
      <Location />
    </MemoryRouter>
  );
  expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Historical logs' }));
  const location = screen.getByLabelText('Location').textContent!;
  expect(new URL(location, 'https://headlamp.test').pathname).toBe('/c/cluster%20a/loki/history');
  expect(parseContext('?' + location.split('?')[1])).toEqual({
    kind,
    namespace: kind === 'Namespace' ? 'orders' : 'shop',
    name: 'orders',
    uid: 'uid-1',
  });
});
it('does not change actions for unsupported or incomplete resources', () => {
  const actions = [{ id: 'POD_LOGS' }];
  expect(historicalActions(null, actions)).toBe(actions);
  expect(
    historicalActions(
      {
        cluster: 'a',
        jsonData: { kind: 'Service', apiVersion: 'v1', metadata: { name: 'x' } },
      } as KubeObject,
      actions
    )
  ).toBe(actions);
});
it('registers the additive details action processor', () => {
  registerHistoricalActions();
  expect(register).toHaveBeenCalledWith(historicalActions);
});
