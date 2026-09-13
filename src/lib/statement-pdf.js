// Builds the printable statement, either for one person or for the whole split.
//
// Everything here reads cents that money.js already worked out. Nothing in this
// file divides or rounds a dollar amount, so a PDF can never disagree with the
// screen it was generated from.

import { jsPDF } from 'jspdf';
import { money } from './money.js';

const PAGE_W = 215.9; // letter, millimetres
const PAGE_H = 279.4;
const MARGIN = 25;
const RIGHT = PAGE_W - MARGIN;
const WIDTH = RIGHT - MARGIN;
const BOTTOM = PAGE_H - 24; // leaves room for the footer
const BLUE = [29, 78, 216]; // #1D4ED8
const GRAY = [100, 116, 139];
const INK = [15, 23, 42];

// The icon is fetched once and kept as a data URL, because building the PDF has
// to be synchronous: iOS only opens a share sheet from the click that asked for
// it, and an await in between loses that permission.
let iconData = null;
let iconTried = false;

export async function preloadStatementIcon() {
  if (iconTried) return iconData;
  iconTried = true;
  try {
    const res = await fetch('/icon-512.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    // The source icon is 512px and lands in every statement. It prints at 16mm,
    // so 192px is already past what a printer can show and keeps the file small.
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, 192, 192);
    iconData = canvas.toDataURL('image/png');
  } catch {
    iconData = null;
  }
  return iconData;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(value) {
  if (!value) return '';
  // A plain date column has no timezone, so read the parts rather than letting
  // the Date constructor shift it back a day.
  const iso = String(value).slice(0, 10).split('-');
  if (iso.length === 3) {
    const [y, m, d] = iso.map(Number);
    if (y && m && d) return `${MONTHS[m - 1]} ${d}, ${y}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}, ${parsed.getFullYear()}`;
}

export function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'split'
  );
}

const HANDLE_FIELDS = [
  ['venmo', 'Venmo', '@'],
  ['cashapp', 'Cash App', '$'],
  ['zelle', 'Zelle', ''],
  ['phone', 'Phone', ''],
  ['email', 'Email', '']
];

/**
 * @param {object}   o
 * @param {object}   o.receipt      rs_receipts row
 * @param {object[]} o.people       rs_people rows
 * @param {object[]} o.items        rs_items rows
 * @param {object[]} o.assignments  rs_item_assignments rows
 * @param {object}   o.split        the splitReceipt() result, already computed
 * @param {?object}  o.payer        the resolved payer person, or null
 * @param {?string}  o.forPersonId  one person's statement, or null for the whole split
 * @param {string}   [o.shareUrl]   printed in the footer
 * @returns {Blob}
 */
export function buildStatementPdf({
  receipt,
  people = [],
  items = [],
  assignments = [],
  split,
  payer = null,
  forPersonId = null,
  shareUrl = ''
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  doc.setFont('helvetica', 'normal');

  const state = { y: MARGIN };
  const payerName = payer ? payer.name : '';
  const title = (receipt?.title || '').trim() || 'Untitled split';

  drawHeader(doc, state);
  drawTitleBlock(doc, state, { title, date: prettyDate(receipt?.event_date || receipt?.created_at), payerName });

  const person = forPersonId ? people.find((p) => p.id === forPersonId) : null;
  if (person) {
    drawPersonStatement(doc, state, { person, split, payer, payerName });
  } else {
    drawFullSplit(doc, state, { people, items, assignments, split, payer, payerName });
  }

  drawFooters(doc, shareUrl);
  return doc.output('blob');
}

// --- layout helpers ---------------------------------------------------------

function ensure(doc, state, height) {
  if (state.y + height <= BOTTOM) return;
  doc.addPage();
  state.y = MARGIN;
}

function rule(doc, state, color = [226, 232, 240], weight = 0.2) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(weight);
  doc.line(MARGIN, state.y, RIGHT, state.y);
}

function text(doc, str, x, y, opts) {
  doc.text(String(str ?? ''), x, y, opts);
}

function setType(doc, size, style = 'normal', color = INK) {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawHeader(doc, state) {
  if (iconData) {
    try {
      doc.addImage(iconData, 'PNG', PAGE_W / 2 - 8, state.y, 16, 16);
      state.y += 22;
    } catch {
      state.y += 2;
    }
  } else {
    state.y += 2;
  }

  setType(doc, 20, 'bold');
  text(doc, 'Halfsies', PAGE_W / 2, state.y, { align: 'center' });
  state.y += 6;

  setType(doc, 9, 'normal', GRAY);
  text(doc, "When your math isn't mathing, go halfsies.", PAGE_W / 2, state.y, { align: 'center' });
  state.y += 5;

  rule(doc, state, BLUE, 0.4);
  state.y += 10;
}

function drawTitleBlock(doc, state, { title, date, payerName }) {
  setType(doc, 16, 'bold');
  const lines = doc.splitTextToSize(title, WIDTH);
  for (const line of lines) {
    text(doc, line, MARGIN, state.y);
    state.y += 7;
  }

  const parts = [];
  if (date) parts.push('Date ' + date);
  if (payerName) parts.push('Paid by ' + payerName);
  if (parts.length) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, parts.join('   '), MARGIN, state.y);
    state.y += 6;
  }
  state.y += 4;
}

function tableHead(doc, state, left, right) {
  setType(doc, 9, 'bold', GRAY);
  text(doc, left, MARGIN, state.y);
  text(doc, right, RIGHT, state.y, { align: 'right' });
  state.y += 2;
  rule(doc, state);
  state.y += 5;
}

// --- one person -------------------------------------------------------------

function drawPersonStatement(doc, state, { person, split, payer, payerName }) {
  const share = split.perPerson.find((p) => p.id === person.id);

  setType(doc, 12, 'bold');
  text(doc, 'Statement for ' + person.name, MARGIN, state.y);
  state.y += 8;

  if (!share || share.lines.length === 0) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, 'Nothing is assigned to this person yet.', MARGIN, state.y);
    state.y += 8;
  } else {
    tableHead(doc, state, 'Item', 'Share');
    for (const line of share.lines) {
      const label = line.name + (line.splitWays > 1 ? ` (split ${line.splitWays} ways)` : '');
      setType(doc, 10, 'normal');
      const wrapped = doc.splitTextToSize(label, WIDTH - 32);
      ensure(doc, state, wrapped.length * 5 + 2);
      text(doc, money(line.shareCents), RIGHT, state.y, { align: 'right' });
      for (const part of wrapped) {
        text(doc, part, MARGIN, state.y);
        state.y += 5;
      }
      state.y += 1;
    }
  }

  ensure(doc, state, 40);
  state.y += 2;
  rule(doc, state);
  state.y += 6;

  const totals = [
    ['Items', share ? share.itemsCents : 0],
    ['Tax', share ? share.taxCents : 0],
    ['Tip', share ? share.tipCents : 0]
  ];
  for (const [label, cents] of totals) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, label, MARGIN, state.y);
    setType(doc, 10, 'normal');
    text(doc, money(cents), RIGHT, state.y, { align: 'right' });
    state.y += 6;
  }

  state.y += 2;
  setType(doc, 11, 'bold');
  text(doc, payerName ? 'Total owed to ' + payerName : 'Total owed', MARGIN, state.y);
  setType(doc, 14, 'bold');
  text(doc, money(share ? share.totalCents : 0), RIGHT, state.y, { align: 'right' });
  state.y += 12;

  if (person.settled) {
    setType(doc, 10, 'normal', GRAY);
    text(doc, person.settled_via ? 'Paid via ' + person.settled_via : 'Paid', MARGIN, state.y);
    state.y += 8;
  }

  const handles = payer
    ? HANDLE_FIELDS.map(([key, label, prefix]) => {
        const value = (payer[key] || '').trim();
        return value ? [label, prefix && !value.startsWith(prefix) ? prefix + value : value] : null;
      }).filter(Boolean)
    : [];

  if (handles.length) {
    ensure(doc, state, 14 + handles.length * 6);
    setType(doc, 11, 'bold');
    text(doc, 'How to pay ' + payerName, MARGIN, state.y);
    state.y += 7;
    for (const [label, value] of handles) {
      setType(doc, 10, 'normal', GRAY);
      text(doc, label, MARGIN, state.y);
      setType(doc, 10, 'normal');
      text(doc, value, MARGIN + 32, state.y);
      state.y += 6;
    }
  }
}

// --- everyone ---------------------------------------------------------------

const COLS = { items: 108, tax: 128, tip: 148, total: 172 };

function drawFullSplit(doc, state, { people, items, assignments, split, payer, payerName }) {
  setType(doc, 12, 'bold');
  text(doc, 'Everyone on this split', MARGIN, state.y);
  state.y += 8;

  setType(doc, 9, 'bold', GRAY);
  text(doc, 'Name', MARGIN, state.y);
  text(doc, 'Items', COLS.items, state.y, { align: 'right' });
  text(doc, 'Tax', COLS.tax, state.y, { align: 'right' });
  text(doc, 'Tip', COLS.tip, state.y, { align: 'right' });
  text(doc, 'Total', COLS.total, state.y, { align: 'right' });
  text(doc, 'Status', RIGHT, state.y, { align: 'right' });
  state.y += 2;
  rule(doc, state);
  state.y += 5;

  const settledBy = new Map(people.map((p) => [p.id, p]));
  for (const share of split.perPerson) {
    ensure(doc, state, 8);
    const who = settledBy.get(share.id);
    setType(doc, 10, 'normal');
    const name = doc.splitTextToSize(share.name, 55)[0];
    text(doc, name, MARGIN, state.y);
    text(doc, money(share.itemsCents), COLS.items, state.y, { align: 'right' });
    text(doc, money(share.taxCents), COLS.tax, state.y, { align: 'right' });
    text(doc, money(share.tipCents), COLS.tip, state.y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    text(doc, money(share.totalCents), COLS.total, state.y, { align: 'right' });
    // The payer is on the split too, but they are not owed by themselves.
    const isPayer = payer && share.id === payer.id;
    setType(doc, 9, 'normal', isPayer || (who && who.settled) ? GRAY : INK);
    text(doc, isPayer ? 'Paid the bill' : who && who.settled ? 'Paid' : 'Owes', RIGHT, state.y, { align: 'right' });
    state.y += 6.5;
  }

  state.y += 1;
  rule(doc, state);
  state.y += 6;

  setType(doc, 10, 'bold');
  text(doc, payerName ? 'Total, paid by ' + payerName : 'Total', MARGIN, state.y);
  text(doc, money(split.assignedCents), COLS.items, state.y, { align: 'right' });
  text(doc, money(split.allocatedTaxCents), COLS.tax, state.y, { align: 'right' });
  text(doc, money(split.allocatedTipCents), COLS.tip, state.y, { align: 'right' });
  text(doc, money(split.grandCents), COLS.total, state.y, { align: 'right' });
  state.y += 12;

  ensure(doc, state, 20);
  setType(doc, 12, 'bold');
  text(doc, 'What was on the bill', MARGIN, state.y);
  state.y += 8;
  tableHead(doc, state, 'Item', 'Price');

  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const byItem = new Map();
  for (const a of assignments) {
    if (!nameById.has(a.person_id)) continue;
    if (!byItem.has(a.item_id)) byItem.set(a.item_id, []);
    byItem.get(a.item_id).push(nameById.get(a.person_id));
  }

  for (const item of items) {
    const who = byItem.get(item.id) || [];
    setType(doc, 10, 'normal');
    const wrapped = doc.splitTextToSize(item.name, WIDTH - 32);
    ensure(doc, state, wrapped.length * 5 + 6);
    text(doc, money(Math.round(Number(item.price) * 100)), RIGHT, state.y, { align: 'right' });
    for (const part of wrapped) {
      text(doc, part, MARGIN, state.y);
      state.y += 5;
    }
    setType(doc, 9, 'normal', GRAY);
    text(doc, who.length ? who.join(', ') : 'Nobody yet', MARGIN + 4, state.y);
    state.y += 7;
  }
}

// --- footer -----------------------------------------------------------------

function drawFooters(doc, shareUrl) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    setType(doc, 8, 'normal', GRAY);
    text(doc, 'Made with Halfsies', MARGIN, PAGE_H - 15);
    if (shareUrl) {
      const short = doc.splitTextToSize(shareUrl, WIDTH * 0.6)[0];
      text(doc, short, RIGHT, PAGE_H - 15, { align: 'right' });
    }
    if (pages > 1) {
      text(doc, `Page ${i} of ${pages}`, PAGE_W / 2, PAGE_H - 10, { align: 'center' });
    }
  }
}

// --- delivery ---------------------------------------------------------------

function probeFile() {
  return new File([new Blob(['x'], { type: 'application/pdf' })], 'probe.pdf', { type: 'application/pdf' });
}

// Whether this browser can hand a file to the share sheet. Used to decide
// whether to warn that an email link cannot carry an attachment.
export function canShareFiles() {
  try {
    return typeof File !== 'undefined' && Boolean(navigator.canShare) && navigator.canShare({ files: [probeFile()] });
  } catch {
    return false;
  }
}

/**
 * Share the PDF if the device has a share sheet, otherwise download it.
 * Called straight from a click so iOS still counts it as a user gesture.
 */
export function deliverPdf(blob, filename, title) {
  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title }).catch(() => {});
      return 'share';
    }
  } catch {
    // fall through to the download
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'download';
}
