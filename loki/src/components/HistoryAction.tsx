import { registerDetailsViewHeaderActionsProcessor, Router } from '@kinvolk/headlamp-plugin/lib';
import { ActionButton } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/KubeObject';
import type { HeaderAction } from '@kinvolk/headlamp-plugin/lib/redux/actionButtonsSlice';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { contextQuery, ResourceContext, resourceContext } from '../api/context';

export function HistoryAction({ context, cluster }: { context: ResourceContext; cluster: string }) {
  const history = useHistory();
  return (
    <ActionButton
      description="Historical logs"
      icon="mdi:history"
      onClick={() => {
        history.push(
          Router.createRouteURL('loki-history', { cluster }) + '?' + contextQuery(context)
        );
      }}
    />
  );
}

export function historicalActions(
  resource: KubeObject | null,
  actions: HeaderAction[]
): HeaderAction[] {
  const context = resourceContext(resource);
  if (!context || !resource?.cluster || actions.some(action => action.id === 'loki-history'))
    return actions;
  return [
    ...actions,
    { id: 'loki-history', action: <HistoryAction context={context} cluster={resource.cluster} /> },
  ];
}

export function registerHistoricalActions() {
  registerDetailsViewHeaderActionsProcessor(historicalActions);
}
