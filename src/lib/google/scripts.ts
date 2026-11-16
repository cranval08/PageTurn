const loading = new Map<string, Promise<void>>();

/** Load an external script once. Rejects (and allows a retry) if it fails. */
export function loadScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      loading.delete(src);
      el.remove();
      reject(new Error(`Couldn't load ${new URL(src).host}. Check your connection.`));
    };
    document.head.appendChild(el);
  });
  loading.set(src, promise);
  return promise;
}
