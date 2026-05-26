type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function apiRequest(method: Method, url: string, body?: unknown): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  return fetch(url, options);
}
