import React, { useEffect, useState } from 'react';
import { ContextKind } from '../api/context';
import { defaults } from '../api/loki';
import { HistoricalSearch } from './SearchView';

export default { title: 'Loki/Historical search', component: HistoricalSearch };
export const Unconfigured = () => <HistoricalSearch cluster="example-cluster" />;

// Story-only configuration: no requests run until the user explicitly searches.
function ContextStory({
  kind,
  missingMapping = false,
}: {
  kind: ContextKind;
  missingMapping?: boolean;
}) {
  const cluster = `story-${kind}-${missingMapping}`;
  const key = 'headlamp.loki.datasources.v1';
  const [previous] = useState(() => {
    const previous = localStorage.getItem(key);
    const all = JSON.parse(previous || '{}');
    localStorage.setItem(
      key,
      JSON.stringify({
        ...all,
        [cluster]: {
          ...defaults,
          clusterValue: 'evaluation-a',
          workloadKindLabel: missingMapping ? '' : 'workload_kind',
          workloadNameLabel: missingMapping ? '' : 'workload_name',
        },
      })
    );
    return previous;
  });
  useEffect(
    () => () => {
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      const old = JSON.parse(previous || '{}');
      if (old[cluster]) all[cluster] = old[cluster];
      else delete all[cluster];
      localStorage.setItem(key, JSON.stringify(all));
    },
    [cluster, previous]
  );
  return (
    <HistoricalSearch
      cluster={cluster}
      context={{
        kind,
        namespace: 'default',
        name: kind === 'Namespace' ? 'default' : 'history-example',
        uid: 'example-uid',
      }}
    />
  );
}
export const Pod = () => <ContextStory kind="Pod" />;
export const Deployment = () => <ContextStory kind="Deployment" />;
export const StatefulSet = () => <ContextStory kind="StatefulSet" />;
export const DaemonSet = () => <ContextStory kind="DaemonSet" />;
export const Job = () => <ContextStory kind="Job" />;
export const Namespace = () => <ContextStory kind="Namespace" />;
export const UnsupportedOwnershipMapping = () => <ContextStory kind="Deployment" missingMapping />;
export const MissingConfiguration = () => (
  <HistoricalSearch
    cluster="unconfigured-context"
    context={{ kind: 'Job', namespace: 'default', name: 'deleted-job' }}
  />
);
