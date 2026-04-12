export interface ApiConfig {
  baseUrl: string;
  token?: string;
}

export function loadApiConfig(): ApiConfig {
  const baseUrl =
    process.env.INSIGHTVIEW_API_URL ?? process.env.API_URL ?? "http://localhost:4000";
  const token = process.env.INSIGHTVIEW_API_TOKEN ?? process.env.API_TOKEN;
  return { baseUrl, token };
}

export async function apiRequest<T>(
  config: ApiConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}
