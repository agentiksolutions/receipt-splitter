import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Codes are generated once per value and kept for the life of the tab. Toggling
// a card open and shut, or a realtime refetch, then costs nothing. Callers only
// mount this when the code is actually on screen.
const cache = new Map();

// Renders at 2x and scales down so the code stays sharp on a phone held across
// a table.
export default function Qr({ value, size = 168, alt }) {
  const key = value + '|' + size;
  const [src, setSrc] = useState(() => cache.get(key) || null);

  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setSrc(hit);
      return;
    }
    let live = true;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    })
      .then((url) => {
        cache.set(key, url);
        if (live) setSrc(url);
      })
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [key, value, size]);

  if (!src) return <div style={{ width: size, height: size }} aria-hidden="true" />;
  return <img src={src} width={size} height={size} alt={alt} />;
}
