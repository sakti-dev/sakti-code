export async function flushMicrotasks(times = 2): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
