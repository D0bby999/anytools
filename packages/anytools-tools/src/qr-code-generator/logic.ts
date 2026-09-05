import QRCode, { type QRCodeErrorCorrectionLevel } from 'qrcode';

export type QrFormat = 'png' | 'svg';

export type QrOptions = {
  errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
  margin?: number;
  scale?: number;
  width?: number;
  darkColor?: string;
  lightColor?: string;
};

export type QrTemplate =
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string }
  | { kind: 'email'; to: string; subject?: string; body?: string }
  | { kind: 'tel'; phone: string }
  | { kind: 'sms'; phone: string; message?: string }
  | {
      kind: 'wifi';
      ssid: string;
      password?: string;
      encryption?: 'WPA' | 'WEP' | 'nopass';
      hidden?: boolean;
    }
  | {
      kind: 'vcard';
      firstName?: string;
      lastName?: string;
      phone?: string;
      email?: string;
      org?: string;
      title?: string;
      url?: string;
    };

const escapeWifi = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
const escapeVcard = (v: string) => v.replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');

export function buildPayload(t: QrTemplate): string {
  switch (t.kind) {
    case 'text':
      return t.text;
    case 'url':
      return t.url;
    case 'email': {
      // RFC 6068 wants percent-encoding. URLSearchParams writes a space as "+", which mail
      // clients show as a literal plus sign in the subject line.
      const params: string[] = [];
      if (t.subject) params.push(`subject=${encodeURIComponent(t.subject)}`);
      if (t.body) params.push(`body=${encodeURIComponent(t.body)}`);
      return `mailto:${t.to}${params.length ? `?${params.join('&')}` : ''}`;
    }
    case 'tel':
      return `tel:${t.phone}`;
    case 'sms':
      // `sms:number?body=` is read by Android and ignored by iOS (which expects `&body=`).
      // SMSTO:number:message is the form QR readers (ZXing and descendants) standardise on
      // and both platforms open with the message filled in.
      return t.message ? `SMSTO:${t.phone}:${t.message}` : `sms:${t.phone}`;
    case 'wifi': {
      const encryption = t.encryption ?? 'WPA';
      const ssid = escapeWifi(t.ssid);
      const pwd = t.password ? escapeWifi(t.password) : '';
      const hidden = t.hidden ? 'true' : 'false';
      return `WIFI:T:${encryption};S:${ssid};P:${pwd};H:${hidden};;`;
    }
    case 'vcard': {
      const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
      const fullName = [t.firstName, t.lastName].filter(Boolean).join(' ').trim();
      if (fullName) lines.push(`FN:${escapeVcard(fullName)}`);
      if (t.lastName || t.firstName) {
        lines.push(`N:${escapeVcard(t.lastName ?? '')};${escapeVcard(t.firstName ?? '')};;;`);
      }
      if (t.org) lines.push(`ORG:${escapeVcard(t.org)}`);
      if (t.title) lines.push(`TITLE:${escapeVcard(t.title)}`);
      if (t.phone) lines.push(`TEL:${escapeVcard(t.phone)}`);
      if (t.email) lines.push(`EMAIL:${escapeVcard(t.email)}`);
      if (t.url) lines.push(`URL:${escapeVcard(t.url)}`);
      lines.push('END:VCARD');
      // RFC 6350 §3.2: lines are CRLF-delimited.
      return lines.join('\r\n');
    }
  }
}

export async function generateQrDataUrl(payload: string, options: QrOptions = {}): Promise<string> {
  if (!payload || !payload.trim()) throw new Error('Payload is empty');
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    margin: options.margin ?? 2,
    scale: options.scale ?? 8,
    width: options.width,
    color: {
      dark: options.darkColor ?? '#000000',
      light: options.lightColor ?? '#FFFFFF',
    },
  });
}

export async function generateQrSvg(payload: string, options: QrOptions = {}): Promise<string> {
  if (!payload || !payload.trim()) throw new Error('Payload is empty');
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    margin: options.margin ?? 2,
    width: options.width,
    color: {
      dark: options.darkColor ?? '#000000',
      light: options.lightColor ?? '#FFFFFF',
    },
  });
}
