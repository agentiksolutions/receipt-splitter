// On-device history of receipts this browser created or opened. No account needed.
const KEY = 'rs.history';

export function historyIds() {
  try {
    // Anything could be sitting under this key. Only ship back a list of ids.
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function remember(id) {
  try {
    const ids = historyIds().filter((x) => x !== id);
    localStorage.setItem(KEY, JSON.stringify([id, ...ids].slice(0, 100)));
  } catch {
    /* private mode: history is just not kept */
  }
}

export function forget(id) {
  try {
    localStorage.setItem(KEY, JSON.stringify(historyIds().filter((x) => x !== id)));
  } catch {
    /* ignore */
  }
}
