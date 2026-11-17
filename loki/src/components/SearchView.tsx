import { ApiProxy, K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  contextFilters,
  grafanaBaseURL,
  grafanaExploreURL,
  identityScope,
  parseContext,
  readTime,
  rememberWindow,
  ResourceContext,
  saveTime,
} from '../api/context';
import {
  Datasource,
  defaults,
  Entry,
  errorMessage,
  INITIAL_LIMIT,
  MAX_LIMIT,
  parseAbsoluteTimestamp,
  query,
  Search,
  searchLogs,
  timestampLabel,
  validateDatasource,
} from '../api/loki';

const CONFIG_KEY = 'headlamp.loki.datasources.v1';
function readConfig(cluster: string): Datasource {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')[cluster] };
  } catch {
    return { ...defaults };
  }
}
const fields: [keyof Datasource, string][] = [
  ['namespace', 'Gateway namespace'],
  ['service', 'Gateway Service'],
  ['port', 'Gateway port'],
  ['clusterValue', 'Stored cluster value'],
  ['clusterLabel', 'Cluster label'],
  ['namespaceLabel', 'Namespace label'],
  ['podLabel', 'Pod label'],
  ['containerLabel', 'Container label'],
  ['workloadKindLabel', 'Recorded workload kind label (optional)'],
  ['workloadNameLabel', 'Recorded workload name label (optional)'],
  ['workloadUidLabel', 'Recorded workload UID label (optional)'],
  ['podUidLabel', 'Recorded Pod UID label (optional)'],
  ['grafanaUrl', 'Grafana base URL (optional)'],
  ['grafanaDatasourceUid', 'Grafana Loki datasource UID (optional)'],
  ['grafanaOrgId', 'Grafana organization ID (optional)'],
];

export interface HistoricalSearchProps {
  cluster: string;
  context?: ResourceContext;
  contextError?: string;
  onStandalone?: () => void;
}

export function HistoricalSearch({
  cluster,
  context,
  contextError,
  onStandalone,
}: HistoricalSearchProps) {
  const [config, setConfig] = useState(() => readConfig(cluster));
  const [initialFilters] = useState(() => contextFilters(context, config));
  const [initialTime] = useState(() => readTime(cluster));
  const [saved, setSaved] = useState<Datasource | null>(null);
  const [range, setRange] = useState(initialTime.range);
  const [start, setStart] = useState(initialTime.start);
  const [end, setEnd] = useState(initialTime.end);
  const [namespace, setNamespace] = useState(initialFilters.namespace);
  const [pod, setPod] = useState(initialFilters.pod);
  const [workloadKind, setWorkloadKind] = useState(initialFilters.workloadKind);
  const [workloadName, setWorkloadName] = useState(initialFilters.workloadName);
  const [resourceUid, setResourceUid] = useState(initialFilters.resourceUid);
  const [container, setContainer] = useState('');
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Search | null>(null);
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const active = useRef<AbortController | null>(null);
  const serial = useRef(0);

  useEffect(() => {
    saveTime(cluster, { range, start, end });
  }, [cluster, range, start, end]);

  const cancel = () => {
    ++serial.current;
    active.current?.abort();
    active.current = null;
    setBusy(false);
  };
  useEffect(
    () => () => {
      ++serial.current;
      active.current?.abort();
    },
    []
  );
  const clear = () => {
    cancel();
    setEntries([]);
    setSnapshot(null);
    setError('');
    setMessage('');
  };
  async function run(test = false, older = false) {
    cancel();
    const id = serial.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30000);
    active.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      validateDatasource(config);
      if (!test && contextError) throw new Error(contextError);
      if (
        !test &&
        !older &&
        range === 'absolute' &&
        ![start, end].every(value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value))
      ) {
        throw new Error('Absolute timestamps must include Z or a timezone offset.');
      }
      const now = Date.now();
      const input: Search = test
        ? {
            namespace: namespace || 'default',
            pod: '',
            container: '',
            text: '',
            start: now - 60000,
            end: now,
          }
        : older && snapshot
        ? snapshot
        : {
            namespace,
            pod,
            container,
            text,
            workloadKind,
            workloadName,
            resourceUid,
            start:
              range === 'absolute' ? parseAbsoluteTimestamp(start) : now - Number(range) * 60000,
            end: range === 'absolute' ? parseAbsoluteTimestamp(end) : now,
          };
      const nextLimit = test ? 1 : older ? Math.min(MAX_LIMIT, limit * 2) : INITIAL_LIMIT;
      const result = await searchLogs(
        (path, signal) =>
          ApiProxy.clusterRequest(path.slice(('/clusters/' + encodeURIComponent(cluster)).length), {
            cluster,
            method: 'GET',
            signal,
            autoLogoutOnAuthError: false,
          }),
        cluster,
        config,
        input,
        nextLimit,
        controller.signal
      );
      if (id !== serial.current) return;
      if (test) setMessage('Connection successful: Loki query API returned a valid response.');
      else {
        setEntries(result);
        setSnapshot(input);
        setLimit(nextLimit);
        setSaved({ ...config });
        rememberWindow(cluster, input);
        setMessage(
          result.length
            ? 'Historical results loaded.'
            : 'No matching retained logs in this time range.'
        );
      }
    } catch (e) {
      if (id === serial.current && (!controller.signal.aborted || timedOut))
        setError(
          timedOut
            ? 'Historical log query timed out. Narrow the time range and retry.'
            : errorMessage(e)
        );
    } finally {
      clearTimeout(timeout);
      if (id === serial.current) {
        setBusy(false);
        active.current = null;
      }
    }
  }
  function save() {
    try {
      validateDatasource(config);
      grafanaBaseURL(config);
      const all = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...all, [cluster]: config }));
      clear();
      setMessage('Datasource saved for this cluster.');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const dirty = snapshot && saved && JSON.stringify(saved) !== JSON.stringify(config);
  const filters = {
    namespace,
    pod,
    container,
    text,
    workloadKind,
    workloadName,
    resourceUid,
    start: 0,
    end: 1,
  };
  let generatedQuery = '';
  let mappingError = contextError || '';
  try {
    generatedQuery = query(config, filters);
  } catch (e) {
    mappingError = mappingError || errorMessage(e);
  }
  let grafanaLink: string | undefined;
  let grafanaError = '';
  if (snapshot && saved && !dirty) {
    try {
      grafanaLink = grafanaExploreURL(saved, snapshot, limit);
    } catch (e) {
      grafanaError = errorMessage(e);
    }
  }
  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Historical logs
      </Typography>
      <Typography paragraph>
        Search logs already collected and retained in Loki, including deleted Pods. Cluster:{' '}
        {cluster}
      </Typography>
      <Alert severity="info">
        Gateway permissions grant access to its configured tenant. Namespace filters are not access
        controls. This plugin stores no Loki credentials.
      </Alert>
      {(context || contextError) && (
        <Box my={2}>
          {context && (
            <Typography>
              Opened from {context.kind} {context.namespace}/{context.name}. Review the
              recorded-label filters before searching.
            </Typography>
          )}
          {onStandalone && <Button onClick={onStandalone}>Open standalone search</Button>}
        </Box>
      )}
      <Box component="details" my={2}>
        <summary>Datasource configuration</summary>
        <Stack spacing={2} mt={2}>
          {fields.map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              value={config[key] || ''}
              onChange={e => {
                clear();
                setConfig({ ...config, [key]: e.target.value });
              }}
            />
          ))}
          <Stack direction="row" spacing={2}>
            <Button onClick={save}>Save datasource</Button>
            <Button disabled={busy} onClick={() => run(true)}>
              Test connection
            </Button>
          </Stack>
        </Stack>
      </Box>
      <Stack spacing={2}>
        <Alert severity="info">{identityScope(filters)}</Alert>
        {mappingError && <Alert severity="warning">{mappingError}</Alert>}
        {context && mappingError && !contextError && (
          <Button
            onClick={() => {
              clear();
              setPod('');
              setContainer('');
              setWorkloadKind('');
              setWorkloadName('');
              setResourceUid('');
            }}
          >
            Search namespace instead
          </Button>
        )}
        <TextField
          label="Exact namespace"
          required
          value={namespace}
          onChange={e => {
            clear();
            setNamespace(e.target.value);
            setResourceUid('');
          }}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Exact Pod name (optional)"
            value={pod}
            onChange={e => {
              clear();
              setPod(e.target.value);
              setResourceUid('');
            }}
            fullWidth
          />
          <TextField
            label="Exact container (optional)"
            value={container}
            onChange={e => {
              clear();
              setContainer(e.target.value);
            }}
            fullWidth
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Workload kind (optional)"
            value={workloadKind}
            onChange={e => {
              clear();
              setWorkloadKind(e.target.value);
              setResourceUid('');
            }}
            fullWidth
          >
            <MenuItem value="">Any workload</MenuItem>
            {['Deployment', 'StatefulSet', 'DaemonSet', 'Job'].map(kind => (
              <MenuItem key={kind} value={kind}>
                {kind}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Exact workload name (optional)"
            value={workloadName}
            onChange={e => {
              clear();
              setWorkloadName(e.target.value);
              setResourceUid('');
            }}
            fullWidth
          />
        </Stack>
        <TextField
          label="Resource UID (optional, requires recorded UID mapping)"
          value={resourceUid}
          onChange={e => {
            clear();
            setResourceUid(e.target.value);
          }}
        />
        <TextField
          label="Log text contains"
          value={text}
          onChange={e => {
            clear();
            setText(e.target.value);
          }}
        />
        <TextField
          select
          label="Time range"
          value={range}
          onChange={e => {
            clear();
            setRange(e.target.value);
          }}
        >
          {[
            ['15', 'Last 15 minutes'],
            ['60', 'Last hour'],
            ['1440', 'Last 24 hours'],
            ['absolute', 'Absolute range (UTC)'],
          ].map(([v, l]) => (
            <MenuItem key={v} value={v}>
              {l}
            </MenuItem>
          ))}
        </TextField>
        {range === 'absolute' && (
          <Stack direction="row" spacing={2}>
            <TextField
              label="Start (ISO 8601 with timezone)"
              placeholder="2026-11-13T10:00:00Z"
              value={start}
              onChange={e => {
                clear();
                setStart(e.target.value);
              }}
              fullWidth
            />
            <TextField
              label="End (ISO 8601 with timezone)"
              placeholder="2026-11-13T11:00:00Z"
              value={end}
              onChange={e => {
                clear();
                setEnd(e.target.value);
              }}
              fullWidth
            />
          </Stack>
        )}
        <Typography variant="subtitle2">Generated LogQL filters</Typography>
        <Box
          component="pre"
          aria-label="Generated LogQL"
          sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', m: 0 }}
        >
          {generatedQuery || 'Unavailable until the configuration and filters are valid.'}
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            disabled={busy || !namespace.trim() || !!mappingError}
            onClick={() => run()}
          >
            Search
          </Button>
          {busy && (
            <>
              <CircularProgress size={24} />
              <Button onClick={cancel}>Cancel</Button>
            </>
          )}
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {message && <Alert severity="info">{message}</Alert>}
        {grafanaError && <Alert severity="warning">Grafana link unavailable: {grafanaError}</Alert>}
        {grafanaLink && (
          <Button component="a" href={grafanaLink} target="_blank" rel="noopener noreferrer">
            Open in Grafana
          </Button>
        )}
        {snapshot && (
          <Typography variant="body2">
            {new Date(snapshot.start).toISOString()} — {new Date(snapshot.end).toISOString()}.
            Showing {entries.length} entries; request limit {limit}.
          </Typography>
        )}
        {entries.length >= limit && (
          <Alert severity="warning">
            Results may be truncated, including entries sharing the boundary timestamp. Load older
            expands the same fixed-window query without deduplicating messages. At 2,000 entries,
            narrow the time range to continue.
          </Alert>
        )}
        <Box
          role="log"
          aria-label="Historical log results"
          tabIndex={0}
          sx={{ maxHeight: 600, overflow: 'auto' }}
        >
          {entries.map((entry, i) => (
            <Box key={i} sx={{ borderBottom: 1, borderColor: 'divider', py: 1 }}>
              <Typography variant="caption">{timestampLabel(entry.timestamp)}</Typography>
              <Typography variant="caption" component="div" sx={{ overflowWrap: 'anywhere' }}>
                {JSON.stringify(entry.labels)}
              </Typography>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', m: 0 }}>
                {entry.line}
              </Box>
            </Box>
          ))}
        </Box>
        {snapshot && entries.length >= limit && (
          <Button disabled={busy || limit >= MAX_LIMIT || !!dirty} onClick={() => run(false, true)}>
            Load older logs
          </Button>
        )}
      </Stack>
    </Box>
  );
}

export default function SearchView() {
  const cluster = K8s.useCluster();
  const location = useLocation();
  const history = useHistory();
  let context: ResourceContext | undefined;
  let contextError = '';
  try {
    context = parseContext(location.search);
  } catch (e) {
    contextError = errorMessage(e);
  }
  return cluster ? (
    <HistoricalSearch
      key={cluster + location.search}
      cluster={cluster}
      context={context}
      contextError={contextError}
      onStandalone={() => history.push(Router.createRouteURL('loki-history', { cluster }))}
    />
  ) : (
    <Alert severity="info">Select a cluster to search historical logs.</Alert>
  );
}
