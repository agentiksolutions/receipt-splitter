// node src/lib/owner.test.js
// The digest here has to match the one Postgres computes inside
// rs_delete_receipt, which is encode(sha256(convert_to(p_token,'utf8')),'hex').
// If the two ever disagree, every owner silently loses the ability to delete
// their own split, and nothing else in the app notices. The two pinned hashes
// below were read back from the live database, not from this code.
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { bytesToHex, deleteHandler, dropToken, mintToken, newToken, saveToken, sha256Hex, tokenFor } from './owner.js';

// owner.js keeps tokens in localStorage, which node has none of. A four-line
// stand-in lets the ownership rules be tested rather than assumed.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

let n = 0;
// Awaited, so a rejected assertion inside an async check fails the run here
// rather than surfacing later as an unhandled rejection after "ok" was printed.
const check = async (name, fn) => {
  await fn();
  n += 1;
  console.log('ok ', name);
};

const PG_ASCII = '3cac341abfcf3816bb7df16fdea5784f4e6019c048d72b6c7f0da4438023e7ea';
const PG_UTF8 = 'a7e46d54289812af2aa5b08c2fbab5d24bccfc6586df55b187272c8a2a31c85f';
const PG_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

await check('sha256Hex matches what Postgres computes', async () => {
  assert.equal(await sha256Hex('halfsies-owner-token'), PG_ASCII);
});

await check('the encoding is utf8, the same as convert_to', async () => {
  // Tokens are hex, so this can never bite in practice. It pins the choice
  // anyway: a latin1 or utf16 encoder gives a different digest here and would
  // give a different one for a token too if the alphabet ever widened.
  assert.equal(await sha256Hex('café ☕'), PG_UTF8);
});

await check('WebCrypto and node crypto agree', async () => {
  const token = newToken();
  assert.equal(await sha256Hex(token), createHash('sha256').update(token, 'utf8').digest('hex'));
});

await check('a token is 32 lowercase hex characters', () => {
  const token = newToken();
  assert.match(token, /^[0-9a-f]{32}$/);
});

await check('two tokens differ', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(newToken());
  assert.equal(seen.size, 200);
});

await check('mintToken hands back the hash of its own token', async () => {
  const { token, hash } = await mintToken();
  assert.equal(hash, await sha256Hex(token));
  assert.match(hash, /^[0-9a-f]{64}$/);
});

await check('bytesToHex pads a low byte', () => {
  assert.equal(bytesToHex(new Uint8Array([0, 15, 16, 255])), '000f10ff');
});

await check('a missing token hashes the empty string, which matches nothing', async () => {
  // The RPC hashes coalesce(p_token,''), and tokenFor returns '' for an unknown
  // id, so the two agree. Returning undefined would hash the text "undefined".
  assert.equal(tokenFor('never-seen'), '');
  assert.equal(await sha256Hex(''), PG_EMPTY);
  assert.notEqual(await sha256Hex(''), await sha256Hex(newToken()));
});

await check('the delete handler is null without a token and the function with one', () => {
  // NEVER wrap this result. A truthy arrow around a null handler is what put a
  // live Delete button on somebody else's trip and threw on the tap.
  const run = () => 'deleted';
  assert.equal(deleteHandler('theirs', run), null);
  assert.equal(Boolean(deleteHandler('theirs', run)), false, 'falsy, so the button does not render');

  saveToken('mine', 'abc123');
  assert.equal(tokenFor('mine'), 'abc123');
  assert.equal(deleteHandler('mine', run), run, 'the function itself, not a wrapper');

  dropToken('mine');
  assert.equal(deleteHandler('mine', run), null);
});

console.log(`\n${n} checks passed.`);
