/* eslint-disable no-unused-vars */
import '../../scss/pages/Swap/swapPage.scss';

import { NativeSwapResume } from './NativeSwapResume';

import SettingsIcon from '../../assets/icons/settings.svg?react';
import ArrowIcon from '../../assets/icons/arrow-down.svg?react';
import ArrowSwap from '../../assets/icons/arrowWhiteLeft.svg?react';

import { useContext, useEffect, useState } from 'react';
import classNames from 'classnames';
import { SwapTable } from './SwapTable';
import { SelectedPageContext, ThemeContext } from '../../context';
import { CHAIN_CONFIG } from '../../config/api';
import { useWallet } from '../../hooks/useWallet';
import { useMultX, MULTX_STEPS } from '@litho/multx-sdk/react';
import { parseTokenAmount } from '@litho/multx-sdk';
import { multxClient, MULTX_CONFIG } from '../../config/multxClient';
import {
  createInitialBridgeDeploymentStatus,
  fetchBridgeDeploymentStatus
} from '../../services/deploymentStatusService';
import { getLithoPrice, formatUsdValue } from '../../services/priceService';
import lithoLogo from '../../assets/icons/litho-mark.png';

export const Swap = () => {
  const { theme } = useContext(ThemeContext);
  const { selectedPage, setSelectedPage } = useContext(SelectedPageContext);

  const wallet = useWallet();
  const {
    txHash,
    step,
    approveToken,
    lockTokens,
    getBridgeStatus,
    getBridgeHistory,
    reset,
    isContractDeployed
  } = useMultX({ client: multxClient, signer: wallet.signer });

  // UI State
  const [selectedFrom, setSelectedFrom] = useState(MULTX_CONFIG.supportedTokens[0] || null);
  const [isOpenFrom, setIsOpenFrom] = useState(false);
  const [selectedDestChain, setSelectedDestChain] = useState(MULTX_CONFIG.destinationChains[0]);
  const [isOpenDestChain, setIsOpenDestChain] = useState(false);
  const [valueFrom, setValueFrom] = useState('1');
  const [showWalletError, setShowWalletError] = useState(false);
  const [walletError, setWalletError] = useState(null);

  // Bridge state
  const [bridgeHistory, setBridgeHistory] = useState([]);

  // Price state
  const [usdValue, setUsdValue] = useState(null);
  const [bridgeDeployment, setBridgeDeployment] = useState(createInitialBridgeDeploymentStatus());

  const prefetchWallet = () => {
    void wallet.prefetch?.();
  };

  useEffect(() => {
    setSelectedPage('Swap');
  }, [setSelectedPage]);

  useEffect(() => {
    let cancelled = false;

    const loadBridgeDeployment = async () => {
      const nextState = await fetchBridgeDeploymentStatus();
      if (!cancelled) setBridgeDeployment(nextState);
    };

    loadBridgeDeployment();
    const interval = window.setInterval(loadBridgeDeployment, 60000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  // Load bridge history when wallet connects
  useEffect(() => {
    let cancelled = false;

    if (!wallet.account || !bridgeDeployment.apiAvailable) {
      setBridgeHistory([]);
      return () => { cancelled = true; };
    }

    getBridgeHistory(wallet.account).then((history) => {
      if (!cancelled) setBridgeHistory(history);
    });

    return () => { cancelled = true; };
  }, [bridgeDeployment.apiAvailable, getBridgeHistory, wallet.account]);

  // Fetch LITHO price and update USD value
  useEffect(() => {
    let cancelled = false;
    getLithoPrice().then(({ price }) => {
      if (!cancelled) setUsdValue(formatUsdValue(parseFloat(valueFrom), price));
    });
    return () => { cancelled = true; };
  }, [valueFrom]);

  const handleFromChange = (e) => {
    const rgx = /^[0-9]*\.?[0-9]*$/;
    if (e.target.value.match(rgx)) setValueFrom(e.target.value);
  };

  const valueTo = (parseFloat(valueFrom) || 0).toFixed(6);

  const handleConnectWallet = async () => {
    try {
      if (wallet.loading) return;
      setShowWalletError(false);
      setWalletError(null);

      const nextWalletState = await wallet.connect();
      const activeChainId = nextWalletState?.chainId ?? wallet.chainId;

      if (activeChainId && activeChainId !== CHAIN_CONFIG.evmChainId) {
        try {
          await wallet.switchToLithoChain();
        } catch (err) {
          setWalletError('Please switch to Lithosphere Kamet network manually');
          setShowWalletError(true);
        }
      }
    } catch (err) {
      setWalletError(err.message);
      setShowWalletError(true);
    }
  };

  const handleDisconnect = () => {
    wallet.disconnect();
    setShowWalletError(false);
    setWalletError(null);
    reset();
  };

  const handleBridge = async () => {
    try {
      if (!wallet.account) {
        setWalletError('Wallet not connected');
        setShowWalletError(true);
        return;
      }

      if (!bridgeDeployment.ready) {
        setWalletError(bridgeDeployment.message);
        setShowWalletError(true);
        return;
      }

      if (!selectedFrom || !selectedFrom.address) {
        setWalletError('Token not supported');
        setShowWalletError(true);
        return;
      }

      if (!isContractDeployed) {
        setWalletError('MultX Bridge contract not deployed yet');
        setShowWalletError(true);
        return;
      }

      const amount = parseTokenAmount(valueFrom, selectedFrom.decimals);
      const tokenMeta = { symbol: selectedFrom.symbol, decimals: selectedFrom.decimals };

      await approveToken(selectedFrom.address, amount, tokenMeta);

      const result = await lockTokens(
        selectedFrom.address,
        amount,
        selectedDestChain.chainId,
        tokenMeta
      );

      if (result.txHash) {
        await getBridgeStatus(result.txHash);
        const history = await getBridgeHistory(wallet.account);
        setBridgeHistory(history);
      }
    } catch (err) {
      setWalletError(err.message);
      setShowWalletError(true);
    }
  };

  const renderActionButton = () => {
    if (!wallet.isConnected) {
      return (
        <button
          type="button"
          className="swap-button primary-btn"
          onClick={() => void handleConnectWallet()}
          onMouseEnter={prefetchWallet}
          onFocus={prefetchWallet}
          disabled={wallet.loading}
        >
          {wallet.loading ? 'Loading Wallet...' : 'Connect Wallet'}
        </button>
      );
    }

    if (wallet.chainId !== 900523) {
      return (
        <div
          className="swap-button primary-btn"
          onClick={() => wallet.switchToLithoChain()}
          onMouseEnter={prefetchWallet}
          onFocus={prefetchWallet}
        >
          Switch to Lithosphere
        </div>
      );
    }

    if (bridgeDeployment.loading) {
      return <div className="swap-button primary-btn disabled">Checking Bridge Status...</div>;
    }

    if (!bridgeDeployment.ready) {
      return <div className="swap-button primary-btn disabled">Bridge Under Maintenance</div>;
    }

    if (!isContractDeployed) {
      return <div className="swap-button primary-btn disabled">Contract Not Deployed</div>;
    }

    if (step === MULTX_STEPS.APPROVING) {
      return <div className="swap-button primary-btn disabled">Approving... (1/2)</div>;
    }

    if (step === MULTX_STEPS.APPROVED || step === MULTX_STEPS.LOCKING) {
      return <div className="swap-button primary-btn disabled">Locking... (2/2)</div>;
    }

    if (step === MULTX_STEPS.LOCKED || step === MULTX_STEPS.WAITING_SIGNATURES) {
      return <div className="swap-button primary-btn disabled">Waiting for Signatures...</div>;
    }

    if (step === MULTX_STEPS.COMPLETED) {
      return <div className="swap-button primary-btn success">Transfer Complete</div>;
    }

    return (
      <div className="swap-button primary-btn" onClick={handleBridge}>
        Bridge Tokens
      </div>
    );
  };

  const renderStepIndicator = () => {
    if (!wallet.isConnected) return null;

    const steps = [
      { name: 'Connect', active: true, completed: true },
      { name: 'Bridge', active: step === MULTX_STEPS.APPROVING || step === MULTX_STEPS.LOCKING, completed: step === MULTX_STEPS.LOCKED || step === MULTX_STEPS.WAITING_SIGNATURES || step === MULTX_STEPS.COMPLETED },
      { name: 'Wait', active: step === MULTX_STEPS.WAITING_SIGNATURES, completed: step === MULTX_STEPS.COMPLETED }
    ];

    return (
      <div className="swap-steps">
        {steps.map((s, idx) => (
          <div
            key={idx}
            className={classNames('swap-step', { active: s.active, completed: s.completed })}
          >
            {s.name}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="swap">
      <NativeSwapResume wallet={wallet} />
      <a className="swap-title">
        Bridge LEP100 tokens from Lithosphere Kamet to Ethereum, BNB Chain, and Base with MultX.
      </a>

      <div className="swap-wrapper">
        <div className="swap-card uniswap">
          <div className="swap-card-title">
            MultX Bridge <SettingsIcon />
            {wallet.isConnected && (
              <div className="wallet-info">
                <div className="network-badge">
                  <img src={lithoLogo} alt="LITHO" className="network-logo" />
                  <span className="network-name">
                    {wallet.chainId === 900523 ? 'Lithosphere Kamet' : `Chain ${wallet.chainId}`}
                  </span>
                </div>
                <span>{wallet.account?.slice(0, 6)}...{wallet.account?.slice(-4)}</span>
                <button className="disconnect-btn" onClick={handleDisconnect}>Disconnect</button>
              </div>
            )}
          </div>

          {showWalletError && walletError && (
            <div className="swap-error-message">⚠️ {walletError}</div>
          )}

          {(bridgeDeployment.loading || !bridgeDeployment.ready) && (
            <div className={`swap-status-message ${!bridgeDeployment.loading && !bridgeDeployment.ready ? 'warning' : ''}`}>
              {bridgeDeployment.message}
            </div>
          )}

          {renderStepIndicator()}

          <div className="swap-convertor">
            {/* From: token on Kamet */}
            <div className="swap-convertor-panel">
              <div className="swap-convertor-panel-values">
                <input
                  type="text"
                  value={valueFrom}
                  onChange={handleFromChange}
                  className="swap-convertor-panel-values-input"
                  placeholder="0"
                  disabled={!wallet.isConnected || bridgeDeployment.loading || !bridgeDeployment.ready}
                />
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span className="token-symbol">{selectedFrom?.symbol}</span>
                  {usdValue && <div className="swap-usd-value">≈ {usdValue}</div>}
                </div>
              </div>

              <div className="swap-convertor-select" onClick={() => setIsOpenFrom(!isOpenFrom)}>
                <div className="swap-convertor-select-button">
                  {selectedFrom?.symbol}
                </div>
                <ArrowIcon className="select-arrow bottom" />
                {isOpenFrom && (
                  <div className="swap-convertor-menu">
                    <div className="items-list">
                      {MULTX_CONFIG.supportedTokens.map((item, i) => (
                        <div key={i} className="item" onClick={() => { setSelectedFrom(item); setIsOpenFrom(false); }}>
                          <span className="item-symbol">{item.symbol}</span>
                          <span className="item-name">{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="swap-convertor-reverse-wrapper">
              <div className="swap-convertor-reverse">
                <ArrowSwap className={theme ? 'select-arrow' : ''} />
              </div>
            </div>

            {/* To: destination chain */}
            <div className="swap-convertor-panel">
              <div className="swap-convertor-panel-values">
                <div className="swap-convertor-panel-values-input">{valueTo}</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span className="token-symbol">{selectedFrom?.symbol}</span>
                  <span className="chain-label">{selectedDestChain?.label}</span>
                </div>
              </div>

              <div className="swap-convertor-select" onClick={() => setIsOpenDestChain(!isOpenDestChain)}>
                <div className="swap-convertor-select-button">
                  {selectedDestChain?.name}
                </div>
                <ArrowIcon className="select-arrow bottom" />
                {isOpenDestChain && (
                  <div className="swap-convertor-menu">
                    <div className="items-list">
                      {MULTX_CONFIG.destinationChains.map((chain, i) => (
                        <div key={i} className="item" onClick={() => { setSelectedDestChain(chain); setIsOpenDestChain(false); }}>
                          <span className="item-symbol">{chain.name}</span>
                          <span className="item-name">{chain.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="swap-output swap-result-sent-value">
            {valueFrom} {selectedFrom?.symbol} on Kamet → {valueTo} {selectedFrom?.symbol} on {selectedDestChain?.name}
          </div>

          <div className="swap-result">
            <div className="swap-result-field">
              <span className="swap-result-field-title">You Send</span>
              <div className="swap-result-sent-value">{valueFrom} {selectedFrom?.symbol} (Kamet)</div>
            </div>
            <div className="swap-result-field">
              <span className="swap-result-field-title">You Receive</span>
              <div className="swap-result-sent-value">{valueTo} {selectedFrom?.symbol} ({selectedDestChain?.name})</div>
            </div>
            <div className="swap-result-sent">
              Cross-Chain Bridge Time
              <div className="swap-result-sent-value">2-5 minutes (pending signatures)</div>
            </div>
          </div>

          {renderActionButton()}

          {txHash && (
            <div className="swap-tx-info">
              <p className="tx-label">Bridge Transaction:</p>
              <p className="tx-hash">{txHash.slice(0, 10)}...{txHash.slice(-8)}</p>
            </div>
          )}
        </div>

        <div className="swap-card transactions">
          <div className="swap-card-title">
            My MultX Transactions
            {wallet.isConnected && (
              <span className="swap-card-title-transactions">{bridgeHistory.length} transactions</span>
            )}
          </div>

          {wallet.isConnected ? (
            bridgeDeployment.apiAvailable ? (
              <SwapTable data={bridgeHistory} />
            ) : (
              <div className="swap-no-data">
                Bridge history is temporarily unavailable while the bridge API health checks fail.
              </div>
            )
          ) : (
            <div className="swap-no-data">Connect your wallet to view transaction history</div>
          )}
        </div>
      </div>
    </div>
  );
};
