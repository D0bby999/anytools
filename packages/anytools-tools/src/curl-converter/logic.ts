export type Target = 'fetch' | 'node-fetch' | 'python' | 'php' | 'go';

export async function convertCurl(curl: string, target: Target): Promise<string> {
  const res = await fetch('/api/curl-convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ curl, target }),
  });
  const data = (await res.json()) as { code?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data.code ?? '';
}
