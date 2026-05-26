import { QueryClient } from "@tanstack/react-query";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

export async function apiRequest(method: Method, url: string, body?: unknown): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  }
  return res;
}
