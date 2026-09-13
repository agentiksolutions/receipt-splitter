// Saved friends, on this device only.
//
// The roster holds other people's payment handles, so it never reaches a shared
// surface: not the share URL, not the PDF statement, not the database, not an
// export. There is no sign-in in this app and nothing here syncs anywhere.
//
// An entry is a copy source. Handles are copied onto a split at the moment a
// friend is added, and nothing links the two afterwards, so editing a friend
// here cannot rewrite a split that is already shared or settled. No rs_people
// row carries a friend id, and none should ever be given one.

import { newToken } from './owner.js';

const KEY = 'rs.friends';

// The handle columns an rs_people row wants. `email` is deliberately left out:
// nothing here pays anybody by email.
const HANDLES = ['venmo', 'venmo_link', 'cashapp', 'paypal', 'zelle', 'phone'];

const text = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

// Anything could be sitting in a stored entry. Every field comes back the type
// the rest of the app expects, or empty.
function normalize(raw) {
  const friend = { id: text(raw.id), name: text(raw.name) };
  for (const key of HANDLES) friend[key] = text(raw[key]);
  friend.accepts = raw.accepts && typeof raw.accepts === 'object' ? { ...raw.accepts } : {};
  friend.preferred = text(raw.preferred);
  friend.lastUsed = Number.isFinite(raw.lastUsed) ? raw.lastUsed : 0;
  return friend;
}

function readAll() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  // An entry with no id cannot be edited, deleted or upserted, so it is dropped
  // rather than repaired.
  return raw.filter((f) => f && typeof f === 'object' && text(f.id)).map(normalize);
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: the roster is just not kept */
  }
}

// A patch carrying `accepts: undefined` would otherwise wipe an accepts map
// that rememberFromPerson put there.
function defined(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) if (value !== undefined) out[key] = value;
  return out;
}

// The same handle gets spelled several ways. Venmo and Cash App names are
// case-insensitive, pay.js strips a leading @ or $ before building any link,
// and nobody types a phone number the same way twice. None of that is a
// different person. Comparison only: the raw value is what gets stored.
function loosely(key, value) {
  return key === 'phone' ? value.replace(/\D/g, '') : value.replace(/^[@$]/, '').toLowerCase();
}

function matchesByName(name) {
  const wanted = text(name).toLowerCase();
  if (!wanted) return [];
  return readAll().filter((f) => f.name.toLowerCase() === wanted);
}

/** Everyone saved, the most recently used first. */
export function listFriends() {
  return readAll().sort((a, b) => b.lastUsed - a.lastUsed);
}

/**
 * Upsert by id. A friend with no id is new and gets one from the crypto RNG.
 * @returns {object} the friend as it was stored
 */
export function saveFriend(friend) {
  const patch = defined(friend);
  const list = readAll();
  const id = text(patch.id) || newToken();
  const at = list.findIndex((f) => f.id === id);
  const base = at < 0 ? { id, lastUsed: Date.now() } : list[at];
  const next = normalize({ ...base, ...patch, id });
  if (at < 0) list.push(next);
  else list[at] = next;
  writeAll(list);
  return next;
}

export function removeFriend(id) {
  const list = readAll();
  const kept = list.filter((f) => f.id !== id);
  if (kept.length !== list.length) writeAll(kept);
}

/**
 * The one friend with this name, matched exactly and ignoring case.
 *
 * Two friends can share a first name. Guessing between them would put somebody
 * else's Venmo on a split, so an ambiguous name answers null, THE SAME as no
 * match at all.
 *
 * That collapse is deliberate and it is a trap for the next caller. Both nulls
 * mean "do not guess", so the only safe response is to do nothing. Never write
 * `if (!findFriendByName(n)) saveFriend(...)`: with two Caseys already saved
 * that mints a third, and once three exist rememberFromPerson refuses that name
 * forever with nothing on screen saying so. A caller that needs to tell the two
 * cases apart must filter listFriends() itself.
 *
 * The one caller, markPayer in Split.jsx, fills nothing on null and lets the
 * pay buttons ask instead.
 */
export function findFriendByName(name) {
  const found = matchesByName(name);
  return found.length === 1 ? found[0] : null;
}

/** Names containing the query, ignoring case. An empty query matches nobody. */
export function searchFriends(query) {
  const needle = text(query).toLowerCase();
  if (!needle) return [];
  return listFriends().filter((f) => f.name.toLowerCase().includes(needle));
}

/** Move a friend to the top of the list. An id nobody holds creates nothing. */
export function touchFriend(id) {
  const list = readAll();
  const at = list.findIndex((f) => f.id === id);
  if (at < 0) return null;
  list[at] = { ...list[at], lastUsed: Date.now() };
  writeAll(list);
  return list[at];
}

/**
 * Just the payment fields, ready to spread onto an rs_people row. The id, the
 * name and lastUsed stay behind: those are roster bookkeeping, and a split
 * carries its own name for the person.
 *
 * Blank fields are left out so a spread can never drag an empty string over
 * something already saved. `accepts` is therefore absent when the friend has
 * said nothing about what they take, so read it as `handlesOf(f).accepts?.venmo`.
 */
export function handlesOf(friend) {
  const from = friend || {};
  const row = {};
  for (const key of HANDLES) {
    const value = text(from[key]);
    if (value) row[key] = value;
  }
  // An all-false accepts map reads as "takes no payment at all", which is not
  // what an untouched friend means.
  const accepts = from.accepts;
  if (accepts && typeof accepts === 'object' && Object.values(accepts).some(Boolean)) {
    row.accepts = { ...accepts };
  }
  const preferred = text(from.preferred);
  if (preferred) row.preferred = preferred;
  return row;
}

/**
 * Is this roster entry the same human as this rs_people row?
 *
 * A shared name is NOT proof, and this is the question `findFriendByName` gets
 * mistaken for. That one answers "is this name unambiguous in the roster",
 * which is a much weaker claim: one David in the roster and one David at the
 * table are still two different men.
 *
 * Proof is positive agreement. They must already share at least one non-blank
 * handle, compared loosely, and disagree on none. Anyone added from the roster
 * chip carries a seeded venmo or phone, so the real "same person" case passes.
 * Somebody typed in by hand matches nothing and gets nothing, which is right.
 *
 * @returns {boolean} true only when the two provably agree
 */
export function samePerson(friend, person) {
  if (!friend || !person) return false;
  let agrees = false;
  for (const key of HANDLES) {
    const mine = text(friend[key]);
    const theirs = text(person[key]);
    if (!mine || !theirs) continue;
    if (loosely(key, mine) !== loosely(key, theirs)) return false;
    agrees = true;
  }
  return agrees;
}

/**
 * Save what a split already knows about somebody, from their rs_people row.
 *
 * Nothing is written and null comes back in four cases. A row with no name or
 * no handle has nothing worth keeping. A name the roster already holds twice
 * is ambiguous: updating one of them would overwrite a stranger's handles, and
 * adding a third would make every later call ambiguous too.
 *
 * The LAST one is the one that matters. A single name match is NOT proof of the
 * same person. Two friends called David are one name and two Venmo usernames,
 * and silently merging them puts one man's username next to the other's phone,
 * so a later split texts David Ruiz asking him to pay David Chen's account.
 * Nothing on screen would say a merge happened. So a handle that CONFLICTS with
 * the one already stored refuses the whole write. Blank fields still fill in,
 * which is the "same person, second split" case this function exists for.
 *
 * Either way the person can still be saved by hand on the Friends screen.
 *
 * @returns {?object} the friend as it was stored
 */
export function rememberFromPerson(person) {
  const name = text(person?.name);
  if (!name) return null;
  const handles = handlesOf(person);
  if (!HANDLES.some((key) => handles[key])) return null;
  const found = matchesByName(name);
  if (found.length > 1) return null;

  const known = found[0];
  if (known) {
    // Any field that disagrees means this is a different person wearing the
    // same name. Refuse rather than guess which one the roster should hold.
    //
    // Compared loosely, so a spelling difference does not cost the user the
    // learn. See `loosely` above.
    const clashes = HANDLES.some((key) => {
      const incoming = text(handles[key]);
      const stored = text(known[key]);
      return incoming && stored && loosely(key, incoming) !== loosely(key, stored);
    });
    if (clashes) return null;
  }
  return saveFriend({ ...handles, id: known?.id, name, lastUsed: Date.now() });
}
