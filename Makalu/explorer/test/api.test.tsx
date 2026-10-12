import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApi } from '@/lib/api';
afterEach(() => { vi.unstubAllGlobals(); });
describe('API request ordering', () => {
  it('does not replace the selected validator sort with an older response', async () => {
    let oldResponse!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { oldResponse = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify(['lowest commission']))));
    const { result, rerender } = renderHook(({ sort }) => useApi<string[]>(`/validators?sort=${sort}`), {
      initialProps: { sort: 'tokens' },
    });
    rerender({ sort: 'commission' });
    await waitFor(() => expect(result.current.data).toEqual(['lowest commission']));
    await act(async () => { oldResponse(new Response(JSON.stringify(['highest power']))); });
    expect(result.current.data).toEqual(['lowest commission']);
  });
});
