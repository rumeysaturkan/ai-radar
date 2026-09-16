const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "ai-radar/1.0 (+https://github.com/topics/ai-radar) Mozilla/5.0 (compatible)";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const response = await fetchWithTimeout(url, init, timeoutMs);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}
