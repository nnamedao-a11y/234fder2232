/**
 * API Helper
 * ----------
 * Resolves the customer session token transparently:
 * 1. `customer_session` in localStorage (JSON with `sessionToken`) — primary
 * 2. `token` (legacy/admin) — fallback
 */

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

/** Read the active customer Bearer token (returns null if no session). */
export function getCustomerToken() {
  try {
    const raw = localStorage.getItem('customer_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      const tok = parsed?.sessionToken || parsed?.accessToken || parsed?.token;
      if (tok) return tok;
    }
  } catch {}
  return localStorage.getItem('token') || null;
}

export async function apiFetch(url, options = {}) {
  const token = getCustomerToken();

  const res = await fetch(`${API_URL}${url}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let detail = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail || body?.message || detail;
    } catch {
      try {
        detail = (await res.text()) || detail;
      } catch {}
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }

  // Some endpoints return arrays directly; honor that.
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

/**
 * User Engagement API
 */
export const userEngagementApi = {
  favorites: {
    getMine: () => apiFetch('/api/favorites/me'),
    add: (payload) =>
      apiFetch('/api/favorites', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    /** identifier accepts VIN or favorite-id */
    remove: (identifier) =>
      apiFetch(`/api/favorites/${encodeURIComponent(identifier)}`, {
        method: 'DELETE',
      }),
    check: (vin) => apiFetch(`/api/favorites/check/${encodeURIComponent(vin)}`),
  },

  compare: {
    getMine: () => apiFetch('/api/compare/me'),
    add: (payload) =>
      apiFetch('/api/compare/add', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    remove: (vehicleId) =>
      apiFetch(`/api/compare/remove/${vehicleId}`, {
        method: 'DELETE',
      }),
    clear: () => apiFetch('/api/compare/clear', { method: 'DELETE' }),
    resolve: () => apiFetch('/api/compare/resolve', { method: 'POST' }),
  },

  history: {
    request: (vin) =>
      apiFetch('/api/history/request', {
        method: 'POST',
        body: JSON.stringify({ vin }),
      }),
    getReport: (vin) => apiFetch(`/api/history/report/${vin}`),
    getQuota: () => apiFetch('/api/history/quota/me'),
  },

  intent: {
    getMyScore: () => apiFetch('/api/intent/me'),
  },
};

export default apiFetch;
