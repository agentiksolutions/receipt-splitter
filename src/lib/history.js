// On-device history of receipts this browser created or opened. No account needed.
import { dropToken } from './owner.js';
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
  // Everything else keyed by this receipt goes with it. Left behind, a stale
  // entry would hand the next split that reuses the id a stranger's answers.
  dropFromMap(MINE_KEY, id);
  dropFromMap(VIEWER_KEY, id);
  dropToken(id);
  try {
    localStorage.removeItem(removedKey(id));
  } catch {
    /* private mode: nothing was stored to remove */
  }
}

function dropFromMap(mapKey, id) {
  try {
    const map = readMap(mapKey);
    if (!(id in map)) return;
    delete map[id];
    localStorage.setItem(mapKey, JSON.stringify(map));
  } catch {
    /* private mode: nothing was stored to remove */
  }
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

// The owner's own name and payment handles, so every split starts with them on
// it and friends can pay them without being asked for anything. Device only,
// same as the rest of this file.
const ME_KEY = 'rs.me';
const PROFILE_KEY = 'rs.profile';

export const SERVICES = ['venmo', 'cashapp', 'paypal', 'zelle', 'applecash'];

export const EMPTY_PROFILE = {
  name: '',
  venmo: '',
  venmo_link: '',
  cashapp: '',
  paypal: '',
  zelle: '',
  phone: '',
  email: '',
  accepts: {},
  preferred: ''
};

export function profile() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') {
    // Anyone who used the app before the profile existed has a bare name.
    let legacy = '';
    try {
      legacy = (localStorage.getItem(ME_KEY) || '').trim();
    } catch {
      legacy = '';
    }
    return { ...EMPTY_PROFILE, name: legacy };
  }
  return {
    ...EMPTY_PROFILE,
    ...raw,
    name: String(raw.name || '').trim(),
    accepts: raw.accepts && typeof raw.accepts === 'object' ? raw.accepts : {}
  };
}

export function saveProfile(next) {
  const merged = { ...profile(), ...next };
  merged.name = String(merged.name || '').trim();
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    // Kept in step so anything still reading the old key sees the same name.
    localStorage.setItem(ME_KEY, merged.name);
  } catch {
    /* private mode: the profile is just not kept */
  }
  return merged;
}

// The handle columns as an rs_people row wants them. Blank fields are left out
// so a spread can never drag an empty string over something already saved.
export function profileHandles(p = profile()) {
  const row = {};
  for (const key of ['venmo', 'venmo_link', 'cashapp', 'paypal', 'zelle', 'phone', 'email']) {
    if ((p[key] || '').trim()) row[key] = p[key].trim();
  }
  // An all-false accepts map would read as "takes no payment at all", which is
  // not what an untouched profile means. Only write it once something is on.
  const accepts = {};
  let any = false;
  for (const key of SERVICES) {
    accepts[key] = Boolean(p.accepts?.[key]);
    if (accepts[key]) any = true;
  }
  if (any) row.accepts = accepts;
  if (p.preferred) row.preferred = p.preferred;
  return row;
}

export function myName() {
  return profile().name;
}

export function setMyName(name) {
  saveProfile({ name });
}

// Taking yourself off a split has to stick. Without this the auto-add would put
// you straight back on the next render.
const removedKey = (receiptId) => 'rs.me.removed.' + receiptId;

export function meRemoved(receiptId) {
  try {
    return localStorage.getItem(removedKey(receiptId)) === '1';
  } catch {
    return false;
  }
}

export function setMeRemoved(receiptId, removed) {
  try {
    if (removed) localStorage.setItem(removedKey(receiptId), '1');
    else localStorage.removeItem(removedKey(receiptId));
  } catch {
    /* private mode: the flag just does not stick */
  }
}

function readMap(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

// The rs_people row this device created for its owner, per receipt. Editing the
// profile writes to exactly these rows. Matching on the name instead would let a
// friend who shares your name have their handles overwritten on a split of
// theirs you happened to open.
const MINE_KEY = 'rs.mine';

export function minePersonId(receiptId) {
  return readMap(MINE_KEY)[receiptId] || '';
}

export function setMinePersonId(receiptId, personId) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify({ ...readMap(MINE_KEY), [receiptId]: personId }));
  } catch {
    /* private mode: the profile edit just does not spread */
  }
}

export function minePersonIds(receiptIds) {
  const map = readMap(MINE_KEY);
  const wanted = new Set(receiptIds);
  return Object.entries(map)
    .filter(([receiptId]) => wanted.has(receiptId))
    .map(([, personId]) => personId)
    .filter(Boolean);
}

// Which person on a split this device is, when the profile name matches nobody.
const VIEWER_KEY = 'rs.viewer';

export function viewerId(receiptId) {
  return readMap(VIEWER_KEY)[receiptId] || '';
}

export function setViewerId(receiptId, personId) {
  try {
    localStorage.setItem(VIEWER_KEY, JSON.stringify({ ...readMap(VIEWER_KEY), [receiptId]: personId }));
  } catch {
    /* private mode: it asks again */
  }
}

// Trips this device knows about. Same shape as the split history: an ordered
// list of ids plus a separate archived list, and never anything else.
const TRIP_KEY = 'rs.trips';
const TRIP_ARCHIVE_KEY = 'rs.trips.archived';

export function tripIds() {
  return readList(TRIP_KEY);
}

export function rememberTrip(id) {
  writeList(TRIP_KEY, [id, ...tripIds().filter((x) => x !== id)].slice(0, 100));
}

export function forgetTrip(id) {
  writeList(TRIP_KEY, tripIds().filter((x) => x !== id));
  writeList(TRIP_ARCHIVE_KEY, archivedTripIds().filter((x) => x !== id));
}

export function archivedTripIds() {
  return readList(TRIP_ARCHIVE_KEY);
}

export function archiveTrip(id) {
  writeList(TRIP_ARCHIVE_KEY, [id, ...archivedTripIds().filter((x) => x !== id)]);
}

export function unarchiveTrip(id) {
  writeList(TRIP_ARCHIVE_KEY, archivedTripIds().filter((x) => x !== id));
}
