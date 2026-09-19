import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeSwapResume } from './NativeSwapResume';
import { openNativeWalletSession } from '../../services/nativeWalletSession';
vi.mock('../../services/nativeWalletSession', () => ({ openNativeWalletSession: vi.fn() }));
const config={enabled:true,baseUrl:'http://localhost/native',audience:'test'};
const wallet={isConnected:true,account:'0x123',chainId:1};
let session;
beforeEach(()=>{session={createQuote:vi.fn(),acceptQuote:vi.fn(),observe:vi.fn(),getProgress:vi.fn(),getStep:vi.fn(),submit:vi.fn(),close:vi.fn(),getDestinationProgress:vi.fn(),getDestinationStep:vi.fn(),submitDestination:vi.fn(),observeDestination:vi.fn()};openNativeWalletSession.mockResolvedValue(session);});
afterEach(()=>{cleanup();vi.clearAllMocks();});
async function load(){fireEvent.change(screen.getByLabelText('Swap ID'),{target:{value:'swap-1'}});fireEvent.click(screen.getByText('Refresh status'));}
describe('native recovery panel',()=>{
 it('requires a separate destination wallet confirmation after settlement',async()=>{
  session.getProgress.mockResolvedValue({swapState:'payout_ready',source:{state:'source_locked'}});
  session.getDestinationProgress.mockResolvedValue({state:'wallet_action_required',step:0,chainId:9005});
  session.getDestinationStep.mockResolvedValue({kind:'approve',chainId:9005,to:'0x99',value:'0'});
  session.submitDestination.mockResolvedValue({state:'submitted'});
  render(<NativeSwapResume wallet={{...wallet,chainId:9005}} config={{...config,destinationBaseUrl:'http://localhost/destination'}}/>);await load();
  const confirm=await screen.findByText('Confirm approve destination trade');expect(session.submitDestination).not.toHaveBeenCalled();
  fireEvent.click(confirm);await screen.findByText('Transaction submitted. Refresh status after confirmation.');
  expect(session.submitDestination).toHaveBeenCalledExactlyOnceWith('swap-1',0);expect(session.submit).not.toHaveBeenCalled();
 });
 it('does not confirm a destination step on the wrong chain',async()=>{
  session.getProgress.mockResolvedValue({swapState:'payout_ready',source:{state:'source_locked'}});
  session.getDestinationProgress.mockResolvedValue({state:'wallet_action_required',step:1,chainId:9005});
  session.getDestinationStep.mockResolvedValue({kind:'trade',chainId:9005,to:'0x99',value:'0'});
  render(<NativeSwapResume wallet={wallet} config={{...config,destinationBaseUrl:'http://localhost/destination'}}/>);await load();
  expect(await screen.findByText('Confirm execute destination trade')).toBeDisabled();
  await screen.findByText('Switch your wallet to chain 9005, then refresh status.');expect(session.submitDestination).not.toHaveBeenCalled();
 });
 it('reconciles a destination attempt without sending another trade',async()=>{
  session.getProgress.mockResolvedValue({swapState:'payout_ready',source:{state:'source_locked'}});
  session.getDestinationProgress.mockResolvedValue({state:'wallet_reconciliation_required',step:1,chainId:9005,submissionReserved:true});
  render(<NativeSwapResume wallet={{...wallet,chainId:9005}} config={{...config,destinationBaseUrl:'http://localhost/destination'}}/>);await load();
  fireEvent.change(await screen.findByLabelText('Wallet transaction hash'),{target:{value:'0x'+'44'.repeat(32)}});
  fireEvent.click(screen.getByText('Reconcile transaction'));await screen.findByText('Transaction linked. Refresh status to check confirmation.');
  expect(session.observeDestination).toHaveBeenCalledExactlyOnceWith('swap-1',1,'0x'+'44'.repeat(32));expect(session.submitDestination).not.toHaveBeenCalled();expect(session.observe).not.toHaveBeenCalled();
 });
 it('is absent unless configuration explicitly enables it',()=>{
  const {container}=render(<NativeSwapResume wallet={wallet} config={{...config,enabled:false}} />);expect(container).toBeEmptyDOMElement();expect(openNativeWalletSession).not.toHaveBeenCalled();
 });
 it('requires explicit confirmation for a prepared source step and sends once',async()=>{
  session.getProgress.mockResolvedValue({swapState:'awaiting_settlement',source:{state:'wallet_reconciliation_required',step:'wrap'}});
  session.getStep.mockResolvedValue({kind:'wrap',chainId:1,to:'0x99',value:'1000'});
  session.submit.mockResolvedValue({state:'submitted'});
  render(<NativeSwapResume wallet={wallet} config={config}/>);await load();
  const button=await screen.findByText('Confirm wrap native input');expect(session.submit).not.toHaveBeenCalled();
  fireEvent.click(button);await screen.findByText('Transaction submitted. Refresh status after confirmation.');
  expect(session.submit).toHaveBeenCalledExactlyOnceWith('swap-1',0);expect(screen.queryByText('Confirm wrap native input')).toBeNull();
 });
 it('does not offer another payment for unknown transactions',async()=>{
  session.getProgress.mockResolvedValue({swapState:'awaiting_settlement',source:{state:'pending_or_unknown'}});
  render(<NativeSwapResume wallet={wallet} config={config}/>);await load();
  await screen.findByText(/No new payment will be sent/);expect(session.getStep).not.toHaveBeenCalled();expect(session.submit).not.toHaveBeenCalled();
 });
 it('clears a prepared step when the connected account changes',async()=>{
  session.getProgress.mockResolvedValue({swapState:'awaiting_settlement',source:{state:'wallet_reconciliation_required',step:'wrap'}});
  session.getStep.mockResolvedValue({kind:'wrap',chainId:1,to:'0x99',value:'1000'});
  const {rerender}=render(<NativeSwapResume wallet={wallet} config={config}/>);await load();await screen.findByText('Confirm wrap native input');
  rerender(<NativeSwapResume wallet={{...wallet,account:'0x456'}} config={config}/>);
  await waitFor(()=>expect(screen.queryByText('Confirm wrap native input')).toBeNull());
 });
 it('does not describe a locked source as a completed swap',async()=>{
  session.getProgress.mockResolvedValue({swapState:'payout_ready',source:{state:'source_locked'}});
  render(<NativeSwapResume wallet={wallet} config={config}/>);await load();await screen.findByText('Source confirmed. Waiting for destination settlement.');expect(screen.queryByText('Swap completed.')).toBeNull();
 });
 it('reconciles a reserved wallet hash without offering a second send',async()=>{
  session.getProgress.mockResolvedValue({swapState:'awaiting_settlement',source:{state:'wallet_reconciliation_required',step:'wrap',submissionReserved:true}});
  session.observe.mockResolvedValue({transactionHash:'0x'+'33'.repeat(32)});
  render(<NativeSwapResume wallet={wallet} config={config}/>);await load();
  const input=await screen.findByLabelText('Wallet transaction hash');
  fireEvent.change(input,{target:{value:'0x'+'33'.repeat(32)}});
  fireEvent.click(screen.getByText('Reconcile transaction'));
  await screen.findByText('Transaction linked. Refresh status to check confirmation.');
  expect(session.getStep).not.toHaveBeenCalled();expect(session.submit).not.toHaveBeenCalled();
  expect(session.observe).toHaveBeenCalledExactlyOnceWith('swap-1',0,'0x'+'33'.repeat(32));
 });
 it('creates no swap until the wallet explicitly accepts the quote',async()=>{
  const quoteId='0x'+'11'.repeat(32),quoteConfig={...config,quoteBaseUrl:'http://localhost/quotes'};
  session.createQuote.mockResolvedValue({quoteId,sourceChain:1,destinationChain:56,inputAmount:'1000000000000000000',minimumOutput:'900000000000000000',terms:{nativeOutputAmount:'900000000000000000',recoveryRef:'test-only',fees:[]},expiresAt:Date.now()+30000});
  session.acceptQuote.mockResolvedValue({swapId:quoteId,alreadyAccepted:false});
  render(<NativeSwapResume wallet={{...wallet,account:'0x0000000000000000000000000000000000000001'}} config={quoteConfig}/>);
  fireEvent.change(screen.getByLabelText('Source chain ID'),{target:{value:'1'}});
  fireEvent.change(screen.getByLabelText('Destination chain ID'),{target:{value:'56'}});
  fireEvent.change(screen.getByLabelText('Native amount'),{target:{value:'1'}});
  fireEvent.change(screen.getByLabelText('Minimum native output'),{target:{value:'0.9'}});
  fireEvent.click(screen.getByText('Get approved quote'));
  await screen.findByText('Accept and create swap');
  expect(session.acceptQuote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Accept and create swap'));
  await waitFor(()=>expect(session.acceptQuote).toHaveBeenCalledExactlyOnceWith(quoteId));
  expect(screen.getByLabelText('Swap ID')).toHaveValue(quoteId);
 });
});
