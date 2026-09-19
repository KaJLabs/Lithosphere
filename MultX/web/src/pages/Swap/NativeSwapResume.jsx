import { useEffect, useRef, useState } from 'react';
import { formatEther, parseEther } from 'ethers';
import { openNativeWalletSession } from '../../services/nativeWalletSession';

const configuration = {
  enabled: import.meta.env.VITE_MULTX_NATIVE_ENABLED === 'true',
  baseUrl: import.meta.env.VITE_MULTX_NATIVE_API_URL,
  quoteBaseUrl: import.meta.env.VITE_MULTX_NATIVE_QUOTE_API_URL,
  destinationBaseUrl: import.meta.env.VITE_MULTX_NATIVE_DESTINATION_API_URL,
  audience: import.meta.env.VITE_MULTX_NATIVE_API_AUDIENCE
};
const labels = { wrap: 'Wrap native input', approve: 'Approve bridge amount', lock: 'Lock bridge input' };
const steps = { wrap: 0, approve: 1, lock: 2 };
const destinationLabels = {approve:'Approve destination trade',trade:'Execute destination trade'};

export function NativeSwapResume({ wallet, config = configuration }) {
  const [swapId, setSwapId] = useState('');
  const [progress, setProgress] = useState(null);
  const [destination, setDestination] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [message, setMessage] = useState('');
  const [quote, setQuote] = useState(null);
  const [request, setRequest] = useState({ sourceChain: '', destinationChain: '', input: '', minimum: '' });
  const [transactionHash, setTransactionHash] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const running = useRef(false);
  useEffect(() => {
    generation.current += 1;
    setProgress(null); setDestination(null); setPrepared(null); setQuote(null); setMessage(''); setTransactionHash('');
  }, [wallet.account, wallet.chainId, swapId]);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => { generation.current += 1; setQuote(null); }, [request]);
  if (!config.enabled || !config.baseUrl || !config.audience) return null;

  async function run(action) {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage('');
    const version = generation.current;
    let session;
    try {
      session = await openNativeWalletSession(wallet, config);
      const result = await action(session, () => version === generation.current);
      if (version === generation.current && result) setMessage(result);
    } catch {
      if (version === generation.current) setMessage('Unable to confirm this step. Check your wallet history before trying again.');
    } finally {
      session?.close(); running.current = false; setBusy(false);
    }
  }
  const load = () => run(async (session, current) => {
    const result = await session.getProgress(swapId.trim());
    if (!current()) return;
    setProgress(result); setDestination(null); setPrepared(null);
    if (result.swapState === 'completed') return result.source.state === 'source_locked' ? 'Swap completed.' : 'Payout recorded. Source history needs operator review.';
    if (result.source.state === 'source_locked') {
      if(result.swapState!=='payout_ready'||!config.destinationBaseUrl)return 'Source confirmed. Waiting for destination settlement.';
      const status=await session.getDestinationProgress(swapId.trim());
      if(!current())return;
      setDestination(status);
      if(status.submissionReserved)return 'A destination wallet attempt is reserved. Enter its hash from wallet history to reconcile it.';
      if(status.state==='wallet_action_required'){
        const intent=await session.getDestinationStep(swapId.trim(),status.step);
        if(current())setPrepared({phase:'destination',step:status.step,intent});
        return Number(wallet.chainId)===status.chainId?'Review and confirm the destination wallet step.':`Switch your wallet to chain ${status.chainId}, then refresh status.`;
      }
      return status.state==='dex_confirmed'?'Destination trade confirmed. Waiting for native payout.':'Destination transaction needs confirmation or operator review. No new payment will be sent.';
    }
    if (result.source.state !== 'wallet_reconciliation_required') return 'Transaction needs confirmation or wallet reconciliation. No new payment will be sent.';
    if (result.source.submissionReserved) return 'A wallet attempt is already reserved. Enter its transaction hash from wallet history to reconcile it.';
    const step = steps[result.source.step];
    if (step === undefined) return 'Contact the operator to reconcile this swap.';
    const intent = await session.getStep(swapId.trim(), step);
    if (current()) setPrepared({ step, intent });
  });
  const send = () => run(async (session, current) => {
    if (!prepared || !current()) return;
    const step = prepared.step,phase=prepared.phase;
    setPrepared(null);
    const result = phase==='destination'?await session.submitDestination(swapId.trim(),step):await session.submit(swapId.trim(), step);
    return result.state === 'submitted' ? 'Transaction submitted. Refresh status after confirmation.' : 'Check wallet history and contact the operator. This step will not be sent again automatically.';
  });
  const createQuote = () => run(async (session, current) => {
    const result = await session.createQuote({
      sourceChain: Number(request.sourceChain), destinationChain: Number(request.destinationChain),
      inputAmount: parseEther(request.input).toString(), minimumOutput: parseEther(request.minimum).toString(),
      recipient: wallet.account
    });
    if (current()) setQuote(result);
    return 'Quote ready. Review it before creating the swap.';
  });
  const acceptQuote = () => run(async (session, current) => {
    if(quote.terms.fundingMode==='dex-wrapped-native'&&!config.destinationBaseUrl)throw Error('Destination wallet service is required.');
    const result = await session.acceptQuote(quote.quoteId);
    if (!current()) return;
    setSwapId(result.swapId); setQuote(null); setProgress(null); setPrepared(null);
    return result.alreadyAccepted ? 'Existing swap restored.' : 'Swap created. Submit each wallet step below.';
  });
  const observe = () => run(async session => {
    if(destination?.submissionReserved)await session.observeDestination(swapId.trim(),destination.step,transactionHash.trim());
    else await session.observe(swapId.trim(), steps[progress.source.step], transactionHash.trim());
    return 'Transaction linked. Refresh status to check confirmation.';
  });
  return <section className="swap-card" aria-label="Resume native swap">
    <h2>Native swap</h2>
    {config.quoteBaseUrl && <div aria-label="Create native swap">
      <p>Request an approved route. Creating a quote does not move funds.</p>
      <label>Source chain ID<input value={request.sourceChain} disabled={busy} inputMode="numeric" onChange={event => setRequest({...request,sourceChain:event.target.value})} /></label>
      <label>Destination chain ID<input value={request.destinationChain} disabled={busy} inputMode="numeric" onChange={event => setRequest({...request,destinationChain:event.target.value})} /></label>
      <label>Native amount<input value={request.input} disabled={busy} inputMode="decimal" onChange={event => setRequest({...request,input:event.target.value})} /></label>
      <label>Minimum native output<input value={request.minimum} disabled={busy} inputMode="decimal" onChange={event => setRequest({...request,minimum:event.target.value})} /></label>
      <button type="button" onClick={createQuote} disabled={busy || !wallet.isConnected || !request.sourceChain || !request.destinationChain || !request.input || !request.minimum}>Get approved quote</button>
      {quote && <div>
        <p>Quote {quote.quoteId}</p>
        <p>{formatEther(quote.inputAmount)} native on chain {quote.sourceChain} to {formatEther(quote.terms.nativeOutputAmount)} native on chain {quote.destinationChain}</p>
        <p>{quote.terms.fundingMode === 'dex-wrapped-native' ? 'Native output requires DEX execution and wrapped-native redemption. Prices may change during settlement; unavailable output requires recovery.' : 'Fixed output from funded liquidity.'} This cross-chain swap is not atomic. Network gas is additional.</p>
        <p>Recovery policy: {quote.terms.recoveryRef}. A timeout does not automatically refund funds.</p>
        {quote.terms.fees.map(fee => <p key={fee.kind}>{fee.kind}: {formatEther(fee.amountBaseUnits)} native on chain {fee.chainId} ({fee.accounting.replaceAll('-', ' ')})</p>)}
        <p>Expires {new Date(quote.expiresAt).toLocaleTimeString()}</p>
        {quote.terms.fundingMode==='dex-wrapped-native'&&!config.destinationBaseUrl&&<p>This route needs a configured destination wallet service.</p>}
        <button type="button" disabled={busy||(quote.terms.fundingMode==='dex-wrapped-native'&&!config.destinationBaseUrl)} onClick={acceptQuote}>Accept and create swap</button>
      </div>}
    </div>}
    <h3>Resume native swap</h3>
    <p>Enter an existing swap ID. Wallet signatures are required to view and update it.</p>
    <label>Swap ID<input value={swapId} disabled={busy} onChange={event => setSwapId(event.target.value)} maxLength={200} /></label>
    <button type="button" onClick={load} disabled={busy || !wallet.isConnected || !swapId.trim()}>Refresh status</button>
    {progress && <p>Swap: {progress.swapState.replaceAll('_', ' ')}</p>}
    {destination&&<p>Destination: {destination.state.replaceAll('_',' ')}</p>}
    {((progress?.source.submissionReserved&&progress.source.state==='wallet_reconciliation_required')||destination?.submissionReserved)&&<div>
      <label>Wallet transaction hash<input value={transactionHash} disabled={busy} onChange={event=>setTransactionHash(event.target.value)} maxLength={66} /></label>
      <button type="button" disabled={busy || !/^0x[0-9a-f]{64}$/i.test(transactionHash.trim())} onClick={observe}>Reconcile transaction</button>
    </div>}
    {prepared && <div>
      <p>{(prepared.phase==='destination'?destinationLabels:labels)[prepared.intent.kind]} on chain {prepared.intent.chainId}</p>
      <p>Contract: {prepared.intent.to}</p>
      {prepared.intent.kind === 'wrap' && <p>Native input: {formatEther(prepared.intent.value)}. Network fees are additional.</p>}
      <button type="button" disabled={busy||Number(wallet.chainId)!==prepared.intent.chainId} onClick={send}>Confirm {(prepared.phase==='destination'?destinationLabels:labels)[prepared.intent.kind]?.toLowerCase()}</button>
    </div>}
    <p role="status">{busy ? 'Waiting for wallet or network...' : message}</p>
  </section>;
}
