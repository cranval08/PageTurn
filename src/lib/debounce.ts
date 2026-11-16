export interface Debounced<A extends unknown[]> {
  call(...args: A): void;
  /** Run the pending call now, if any. */
  flush(): void;
  /** Arguments of the call still waiting to run, if any. */
  pending(): A | null;
  cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | null = null;
  const run = () => {
    timer = undefined;
    if (!pending) return;
    const args = pending;
    pending = null;
    fn(...args);
  };
  return {
    call(...args) {
      pending = args;
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    },
    flush() {
      clearTimeout(timer);
      run();
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
    pending: () => pending,
  };
}
