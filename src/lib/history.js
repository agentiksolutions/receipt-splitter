// On-device history of receipts this browser created or opened. No account needed.
const KEY = 'rs.history';
const ARCHIVE_KEY = 'rs.archived';

function readList(key) {
  try {
    // Anything could be sitting under this key. Only ship back a list of ids.
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* private mode: history is just not kept */
  }
}

export function historyIds() {
  return readList(KEY);
}

export function remember(id) {
  writeList(KEY, [id, ...historyIds().filter((x) => x !== id)].slice(0, 100));
}

export function forget(id) {
  writeList(KEY, historyIds().filter((x) => x !== id));
  writeList(ARCHIVE_KEY, archivedIds().filter((x) => x !== id));
}

// Archiving is a local tidy-up. It hides a split on this device and never
// touches the database, so anyone else with the link still sees it.
export function archivedIds() {
  return readList(ARCHIVE_KEY);
}

export function archive(id) {
  writeList(ARCHIVE_KEY, [id, ...archivedIds().filter((x) => x !== id)]);
}

export function unarchive(id) {
  writeList(ARCHIVE_KEY, archivedIds().filter((x) => x !== id));
}
