export class ConnectionError extends Error {
  constructor() {
    super('Derzeit offline. Sobald die Verbindung wieder da ist, wird automatisch synchronisiert.');
    this.name = 'ConnectionError';
  }
}
let reachable = true;
export const connectionOffline = () => !navigator.onLine || !reachable;
export function isConnectionError(error: unknown): boolean {
  return (
    error instanceof ConnectionError ||
    /failed to fetch|networkerror|load failed|error sending request/i.test(String(error))
  );
}
function availability(value: boolean) {
  if (reachable === value) return;
  reachable = value;
  window.dispatchEvent(new Event('notto-connection'));
}
export async function networkFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (!navigator.onLine) {
    availability(false);
    throw new ConnectionError();
  }
  const controller = new AbortController();
  const offline = () => controller.abort();
  window.addEventListener('offline', offline);
  try {
    const response = await fetch(input, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
    });
    availability(true);
    return response;
  } catch (error) {
    if (
      error instanceof TypeError ||
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === 'TimeoutError') ||
      isConnectionError(error)
    ) {
      availability(false);
      throw new ConnectionError();
    }
    throw error;
  } finally {
    window.removeEventListener('offline', offline);
  }
}
