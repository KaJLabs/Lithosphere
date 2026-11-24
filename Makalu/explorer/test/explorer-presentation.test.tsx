import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SyncStatusBanner from '../components/SyncStatusBanner';
import { formatGasPrice } from '../lib/format';
import type { StatsSummary } from '../lib/types';

describe('explorer presentation', () => {
  it('identifies the latest transaction height as a block, without inventing a cause for lag', () => {
    render(<SyncStatusBanner stats={{
      tipHeight: 14707372, chainTipHeight: 14708308, latestTransactionHeight: 14707372,
      syncLagBlocks: 936, isSyncing: true, inconsistentBlocks: 0,
      latestBlockTimestamp: null, latestTransactionTimestamp: null, avgBlockTime: 1.2,
    } as StatsSummary} />);
    expect(screen.getByText('Block with latest transaction')).toBeTruthy();
    expect(screen.queryByText(/may contain zero transactions/)).toBeNull();
    expect(screen.getByText(/18m 44s/)).toBeTruthy();
  });

  it('rounds Mafic gas prices up to three significant digits without displaying zero', () => {
    expect(formatGasPrice('8035714285')).toBe('0.000000804 Mafic/gas');
    expect(formatGasPrice('1')).toBe('0.0000000000000001 Mafic/gas');
  });
});
