// Who is allowed to delete a split.
//
// There is no sign-in, so the proof of ownership is a random token generated on
// the device that created the row. Only its sha256 goes to the server, in
// rs_receipts.owner_token_hash, and deletion runs through an RPC that compares
// the two. A friend holding the link has no token, sees no delete control, and
// could not delete the bill even by calling the RPC directly.
//
// The digest must match what Postgres computes: the RPC does
// encode(sha256(convert_to(p_token,'utf8')),'hex'). sha256Hex mirrors that
// exactly, and pinning it is the whole point of owner.test.js.

const KEY = 'rs.tokens';

function readMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** 32 characters from the crypto RNG, not Math.random. */
export function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

export function tokenFor(id) {
  return readMap()[id] || '';
}

export function saveToken(id, token) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readMap(), [id]: token }));
  } catch {
    /* private mode: this device just cannot delete later */
  }
}

export function dropToken(id) {
  try {
    const map = readMap();
    delete map[id];
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* nothing to do */
  }
}

/** True when this device made the row, which is also what shows the Delete button. */
export function owns(id) {
  return Boolean(tokenFor(id));
}

/**
 * The delete handler, or null when this device cannot delete that row.
 *
 * NEVER wrap the result. A truthy arrow around a null handler is what put a
 * live Delete button on somebody else's trip and threw on the tap.
 */
export function deleteHandler(id, run) {
  return owns(id) ? run : null;
}

/**
 * Make a token, keep it, and hand back the hash to store on the row.
 * @returns {Promise<{token:string, hash:string}>}
 */
export async function mintToken() {
  const token = newToken();
  return { token, hash: await sha256Hex(token) };
}
