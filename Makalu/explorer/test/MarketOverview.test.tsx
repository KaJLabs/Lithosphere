import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const { useApi } = vi.hoisted(() => ({ useApi: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi }));
import MarketOverview, { supplyValuation } from '@/components/MarketOverview';
describe('LITHO market overview', () => {
  it('calculates total-supply valuation without losing base units', () => {
    expect(supplyValuation('999999999999999999999999999', '1')).toBe('999,999,999.99');
    expect(supplyValuation('1000000000000000000', '0.123456789012345678')).toBe('0.12');
  });
  it('uses the requested USD presentation and fixed circulation', () => {
    useApi.mockReturnValue({ loading: false, error: null, data: {
      market: { price: '8.7', currency: 'USDT', source: 'Ignite DEX', kind: 'last trade', updatedAt: null },
      totalSupply: '1000000000000000000000000000', bondedTokens: '1', transactionsPerSecond: '0.25',
    } });
    render(<MarketOverview />);
    expect(screen.getByText('$8.70 USD')).toBeInTheDocument();
    expect(screen.getByText('$8,700,000,000 USD')).toBeInTheDocument();
    expect(screen.getByText('60,000,000')).toBeInTheDocument();
    expect(screen.getByText('$522,000,000 USD')).toBeInTheDocument();
    expect(screen.getByText('0.000000000000000001 LITHO')).toBeInTheDocument();
  });
  it('labels a launch quote separately from a traded market price', () => {
    useApi.mockReturnValue({ loading: false, error: null, data: {
      market: { price: '8.7', currency: 'USDT', source: 'Ignite DEX', kind: 'launch price' },
      totalSupply: '1000000000000000000000000000',
    } });
    render(<MarketOverview />);
    expect(screen.getByText('LITHO launch price')).toBeInTheDocument();
    expect(screen.getByText('$8.70 USD')).toBeInTheDocument();
    expect(screen.getByText('Fully diluted valuation (FDV)')).toBeInTheDocument();
    expect(screen.getByText(/open-market trading has not started/)).toBeInTheDocument();
  });
  it('never presents a stale cached quote after a request failure', () => {
    useApi.mockReturnValue({ loading: false, error: 'offline', data: { market: { price: '8.7', currency: 'USDT' } } });
    render(<MarketOverview />);
    expect(screen.queryByText('$8.70 USD')).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for a fresh Ignite or Magma quote')).toBeInTheDocument();
  });
});
