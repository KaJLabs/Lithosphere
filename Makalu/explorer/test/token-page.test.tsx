import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preferLitho } from '../lib/format';
import type { ApiTokenDetail } from '../lib/types';

const state = vi.hoisted(() => ({ token: {} as ApiTokenDetail, tab: 'contract', replace: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ query: { address: 'litho19y28h6a3cjwr5492geqnwcgluuys3m0nqxcgrs', tab: state.tab }, pathname: '/token/[address]', push: vi.fn(), replace: state.replace }) }));
vi.mock('@web3modal/ethers/react', () => ({ useWeb3Modal: () => ({ open: vi.fn() }), useWeb3ModalProvider: () => ({}) }));
vi.mock('../lib/api', () => ({ useApi: () => ({ data: state.token, loading: false, error: null, refetch: vi.fn() }) }));
import TokenDetailPage from '../pages/token/[address]';

afterEach(() => { cleanup(); state.replace.mockClear(); });
function token(overrides: Partial<ApiTokenDetail> = {}) {
  state.token = { address: '0x29147bebb1c49c3a54aa464137611fe708886df3', contractAddress: '0x29147bebb1c49c3a54aa464137611fe708886df3',
    name: 'Lithosphere Algorithmic', symbol: 'LAX', decimals: 18, holders: 7, transfers: 7, type: 'LEP100', runtime: 'lithic',
    totalSupply: '10000000000000000000000000000', verified: false, verifiedBadge: true, official: true, ...overrides };
  state.tab = 'contract';
}
describe('token identity presentation', () => {
  it('shows a simple official mark and Litho addresses without EVM aliases', () => {
    token(); render(<TokenDetailPage />);
    expect(screen.getAllByRole('img', { name: 'Official token' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Unverified')).toBeNull();
    expect(screen.queryByText('EVM format:')).toBeNull();
    expect(screen.queryByText(state.token.address)).toBeNull();
    expect(screen.getAllByText(preferLitho(state.token.address)).length).toBeGreaterThan(0);
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('removes the unclaimed badge while retaining the warning', () => {
    token({ verifiedBadge: false, official: false }); render(<TokenDetailPage />);
    expect(screen.queryByText('Unverified')).toBeNull();
    expect(screen.getByText(/Token ownership has not been verified/)).toBeTruthy();
  });
  it('labels Lithic token profiles and retains EVM aliases for Solidity tokens', () => {
    token(); state.tab = 'info'; const view = render(<TokenDetailPage />);
    expect(screen.getByText('LEP-100 Lithic')).toBeTruthy();
    view.unmount(); token({ runtime: 'evm' }); render(<TokenDetailPage />);
    expect(screen.getAllByText('EVM format:').length).toBeGreaterThan(0);
  });
});
