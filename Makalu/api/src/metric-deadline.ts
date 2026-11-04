/** Slow analytics may finish in the shared cache without holding the homepage open. */
export async function metricDeadline<T>(work: Promise<T>, timeoutMs = 1500): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
