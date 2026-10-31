// Pick people out of the phone's own address book.
//
// This is the Contact Picker API, and it exists on exactly one phone browser:
// Chrome on Android. Safari on iPhone does not implement it and never has, and
// no web app on an iPhone can read the contact list by any route, so on an
// iPhone the button that calls this is simply not shown. Do not "fix" that by
// showing it anyway; a button that does nothing is worse than no button.
//
// The picker is the phone's own sheet. The app sees only the contacts the
// person ticks, and only the fields asked for, once. Nothing here is stored
// beyond the name and number that go onto the split like any typed name.

export function canPickContacts() {
  if (typeof navigator === 'undefined') return false;
  const c = navigator.contacts;
  return Boolean(c && typeof c.select === 'function');
}

/**
 * Open the phone's contact sheet. Resolves to [{ name, phone }] for whoever
 * was ticked, or [] if the sheet was closed. Never throws on a cancel.
 */
export async function pickContacts() {
  if (!canPickContacts()) return [];
  let picked = [];
  try {
    picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
  } catch {
    // Closed the sheet, or denied. Either way there is nothing to add.
    return [];
  }
  return picked
    .map((c) => ({
      name: String((c.name || [])[0] || '').trim(),
      phone: String((c.tel || [])[0] || '').trim()
    }))
    .filter((c) => c.name);
}
