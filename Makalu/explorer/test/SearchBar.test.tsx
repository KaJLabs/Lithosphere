import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { push, apiFetch } = vi.hoisted(() => ({ push: vi.fn(), apiFetch: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({ apiFetch }));
import SearchBar from '@/components/SearchBar';
beforeEach(() => {
  push.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/tokens') return [{ name: 'Lithosphere', symbol: 'LITHO', type: 'native' }];
    if (path.startsWith('/txs')) return { txs: [] };
    return [{ moniker: 'Everest Nodes', address: 'lithovaloper1example' }];
  });
});
describe('suggested searches', () => {
  it('keeps a suggestion tappable when Safari blurs the input without a related target', async () => {
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await screen.findByText('Lithosphere (LITHO)');
    fireEvent.blur(input, { relatedTarget: null });
    fireEvent.click(screen.getByText('Lithosphere (LITHO)'));
    expect(push).toHaveBeenCalledWith('/token/native');
  });
  it('shows real token suggestions on focus and selects with the keyboard', async () => {
    const onNavigate = vi.fn();
    render(<SearchBar onNavigate={onNavigate} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    await screen.findByText('Lithosphere (LITHO)');
    fireEvent.change(input, { target: { value: 'LITHO' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.submit(input.closest('form')!);
    expect(push).toHaveBeenCalledWith('/token/native');
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  it('filters pages and closes with Escape', async () => {
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
    await waitFor(() => expect(screen.queryByText('Lithosphere (LITHO)')).not.toBeInTheDocument());
    expect(screen.getByText('Latest blocks')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
  it('keeps page navigation available when the data endpoints fail', async () => {
    apiFetch.mockRejectedValue(new Error('offline'));
    render(<SearchBar />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Latest blocks'));
    expect(push).toHaveBeenCalledWith('/blocks');
  });
  it('routes a full transaction hash directly and reports unknown text without a bogus tx route', () => {
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zebra unknown' } });
    fireEvent.submit(input.closest('form')!);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('No suggestions match');
    const hash = '85D2021E9996402CB31F04B6953753F91B8BDC28AF3B6C25168E7FFEE1F1C378';
    fireEvent.change(input, { target: { value: hash } });
    fireEvent.submit(input.closest('form')!);
    expect(push).toHaveBeenCalledWith(`/txs/${hash}`);
  });
});
