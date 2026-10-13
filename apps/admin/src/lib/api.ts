export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export async function apiFetch(route: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_URL}${route}`, { ...init, signal: init?.signal || AbortSignal.timeout(15000) });
  if (response.status === 401) {
    localStorage.removeItem('admin_token');
    window.dispatchEvent(new Event('auth-expired'));
    throw new Error('Your session expired. Sign in again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response;
}
