import { useRef, useState } from 'react';
import { createNativeVaultStatusBackend } from '@litho/multx-sdk';

const configuration = () => {
  if (import.meta.env.VITE_MULTX_NATIVE_VAULT_STATUS_ENABLED !== 'true') return { enabled: false };
  try {
    return { enabled: true, baseUrl: import.meta.env.VITE_MULTX_NATIVE_VAULT_STATUS_API_URL,
      routes: JSON.parse(import.meta.env.VITE_MULTX_NATIVE_VAULT_STATUS_ROUTES) };
  } catch { return { enabled: false }; }
};

const labels = {
  awaiting_destination: 'Deposit confirmed. Waiting for destination payout.',
  payout_observed: 'Payout observed. Waiting for source finalization.',
  cancellation_observed: 'Destination cancellation observed. Waiting for source refund.',
  completed: 'Payout and source finalization confirmed.',
  refunded: 'Source refund confirmed.',
};

export function NativeVaultStatus({ config = configuration() }) {
  const [operationId, setOperationId] = useState('');
  const [routeIndex, setRouteIndex] = useState(0);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  if (!config.enabled) return null;

  let backend;
  try { backend = createNativeVaultStatusBackend(config); }
  catch { return null; }
  const route = config.routes[routeIndex];
  const lookup = async event => {
    event.preventDefault();
    const version = ++requestVersion.current;
    setStatus(null); setError(''); setLoading(true);
    try {
      const result = await backend.getOperation(route.sourceChainId, route.destinationChainId, operationId.trim());
      if (version === requestVersion.current) setStatus(result);
    } catch {
      if (version === requestVersion.current) setError('Operation status is unavailable. Check the operation ID or try again.');
    } finally { if (version === requestVersion.current) setLoading(false); }
  };
  return <section aria-label="Native vault status" className="native-vault-status">
    <h2>Native vault status</h2>
    <p>Read-only status from the source and destination vaults.</p>
    <form onSubmit={lookup}>
      <label htmlFor="native-vault-route">Route</label>
      <select id="native-vault-route" value={routeIndex} onChange={event => {
        requestVersion.current++;
        setRouteIndex(Number(event.target.value)); setStatus(null); setError('');
        setLoading(false);
      }}>
        {config.routes.map((item, index) => <option key={`${item.sourceChainId}:${item.destinationChainId}`} value={index}>
          {item.sourceChainId} → {item.destinationChainId}
        </option>)}
      </select>
      <label htmlFor="native-vault-operation">Operation ID</label>
      <input id="native-vault-operation" value={operationId} onChange={event => {
        requestVersion.current++;
        setOperationId(event.target.value); setStatus(null); setError('');
        setLoading(false);
      }} placeholder="0x…" autoComplete="off" />
      <button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Check status'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {status && <div role="status">
      <p>{labels[status.status]}</p>
      <p>Source block: {status.sourceAnchor.number} · Destination block: {status.destinationAnchor.number}</p>
    </div>}
  </section>;
}
