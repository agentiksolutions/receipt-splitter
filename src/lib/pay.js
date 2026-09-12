// Payment link builders.
//
// What each app actually supports through a link, which is not much:
//   Venmo     amount and note, for both charge and pay
//   Cash App  amount, send direction only
//   Zelle     nothing
//   Apple Pay nothing
// Everything unsupported falls back to a prefilled text with the amount in it.

import { fromCents } from './money.js';

const DEFAULT_LABEL = 'the receipt split';

export function reasonFor(title) {
  const t = (title || '').trim();
  if (!t || t.toLowerCase() === 'untitled receipt') return DEFAULT_LABEL;
  return t;
}

function sms(phone, body) {
  return `sms:${phone ? encodeURIComponent(phone) : ''}?body=${encodeURIComponent(body)}`;
}

const clean = (handle) => (handle || '').trim().replace(/^[@$]/, '');

/**
 * @param {object} person   rs_people row, holds their handles
 * @param {number} cents    what they owe
 * @param {'request'|'send'} mode
 * @param {string} title    receipt title, used as the note
 * @returns {{venmo:?string, cashapp:?string, zelle:?string, applepay:string, note:string}}
 */
export function buildPaymentLinks(person, cents, mode, title) {
  const amount = fromCents(cents);
  const reason = reasonFor(title);
  const venmo = clean(person.venmo);
  const cashtag = clean(person.cashapp);
  const zelle = (person.zelle || '').trim();
  const phone = (person.phone || '').trim();

  const links = { venmo: null, cashapp: null, zelle: null, applepay: null };

  if (venmo) {
    const txn = mode === 'request' ? 'charge' : 'pay';
    links.venmo =
      `https://venmo.com/${encodeURIComponent(venmo)}` +
      `?txn=${txn}&amount=${amount}&note=${encodeURIComponent(reason)}`;
  }

  if (cashtag) {
    links.cashapp =
      mode === 'send'
        ? `https://cash.app/$${encodeURIComponent(cashtag)}/${amount}`
        : sms(phone, `Can you Cash App me $${amount} for ${reason}? My cashtag is $${cashtag}`);
  }

  if (zelle) {
    links.zelle = sms(
      phone,
      mode === 'request'
        ? `Can you Zelle me $${amount} for ${reason}? Send it to ${zelle}`
        : `Sending you $${amount} by Zelle to ${zelle} for ${reason}.`
    );
  }

  links.applepay = sms(
    phone,
    mode === 'request'
      ? `Can you Apple Pay me $${amount} for ${reason}?`
      : `Sending you $${amount} by Apple Pay for ${reason}.`
  );

  return links;
}

// The itemised breakdown, used by both the text and the email link.
function breakdown(lines) {
  return lines
    .map((l) => `  ${l.name} $${fromCents(l.shareCents)}${l.splitWays > 1 ? ` (split ${l.splitWays} ways)` : ''}`)
    .join('\n');
}

export function buildShareLinks(share, title) {
  const reason = reasonFor(title);
  const amount = fromCents(share.totalCents);
  const body =
    `${reason}\n\n${breakdown(share.lines)}\n\n` +
    `Items $${fromCents(share.itemsCents)}\n` +
    `Tax $${fromCents(share.taxCents)}\n` +
    `Tip $${fromCents(share.tipCents)}\n` +
    `${share.name} owes $${amount}`;

  return {
    text: sms(share.phone, body),
    email:
      `mailto:${encodeURIComponent(share.email || '')}` +
      `?subject=${encodeURIComponent(reason)}&body=${encodeURIComponent(body)}`
  };
}
