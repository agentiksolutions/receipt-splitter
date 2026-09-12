import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Renders at 2x and scales down so the code stays sharp on a phone screen
// held across a table.
export default function Qr({ value, size = 168, alt }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value, size]);

  if (!src) return null;
  return <img src={src} width={size} height={size} alt={alt} />;
}
