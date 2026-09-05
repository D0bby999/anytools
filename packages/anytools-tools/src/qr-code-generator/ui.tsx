'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { type QrTemplate, buildPayload, generateQrDataUrl, generateQrSvg } from './logic';
import { STRINGS } from './strings';

type Kind = QrTemplate['kind'];

export function QrCodeGeneratorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState({ to: '', subject: '', body: '' });
  const [tel, setTel] = useState('');
  const [wifi, setWifi] = useState({
    ssid: '',
    password: '',
    encryption: 'WPA' as 'WPA' | 'WEP' | 'nopass',
  });
  const [vcard, setVcard] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    org: '',
    title: '',
    url: '',
  });

  const [ecc, setEcc] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [darkColor, setDarkColor] = useState('#000000');
  const [lightColor, setLightColor] = useState('#FFFFFF');

  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildTemplate = (): QrTemplate => {
    switch (kind) {
      case 'text':
        return { kind: 'text', text };
      case 'url':
        return { kind: 'url', url };
      case 'email':
        return {
          kind: 'email',
          to: email.to,
          subject: email.subject || undefined,
          body: email.body || undefined,
        };
      case 'tel':
        return { kind: 'tel', phone: tel };
      case 'sms':
        return { kind: 'sms', phone: tel };
      case 'wifi':
        return {
          kind: 'wifi',
          ssid: wifi.ssid,
          password: wifi.password || undefined,
          encryption: wifi.encryption,
        };
      case 'vcard':
        return { kind: 'vcard', ...vcard };
    }
  };

  useEffect(() => {
    const tmpl = buildTemplate();
    let payload: string;
    try {
      payload = buildPayload(tmpl);
    } catch (e) {
      setError(toolErrorText(e, s, ui.invalidInput));
      setPngUrl(null);
      setSvg(null);
      return;
    }
    if (!payload.trim()) {
      setError(null);
      setPngUrl(null);
      setSvg(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      generateQrDataUrl(payload, { errorCorrectionLevel: ecc, darkColor, lightColor }),
      generateQrSvg(payload, { errorCorrectionLevel: ecc, darkColor, lightColor }),
    ])
      .then(([png, sv]) => {
        if (cancelled) return;
        setPngUrl(png);
        setSvg(sv);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(toolErrorText(e, s, s.generationFailed));
        setPngUrl(null);
        setSvg(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, text, url, email, tel, wifi, vcard, ecc, darkColor, lightColor, s, ui.invalidInput]);

  const downloadSvg = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `qr-${kind}-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="text">{s.tabText}</TabsTrigger>
            <TabsTrigger value="url">URL</TabsTrigger>
            <TabsTrigger value="email">{s.tabEmail}</TabsTrigger>
            <TabsTrigger value="tel">{s.tabPhone}</TabsTrigger>
            <TabsTrigger value="sms">SMS</TabsTrigger>
            <TabsTrigger value="wifi">Wi-Fi</TabsTrigger>
            <TabsTrigger value="vcard">vCard</TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={s.anyText}
            />
          </TabsContent>
          <TabsContent value="url">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </TabsContent>
          <TabsContent value="email" className="space-y-2">
            <Input
              value={email.to}
              onChange={(e) => setEmail({ ...email, to: e.target.value })}
              placeholder="to@example.com"
            />
            <Input
              value={email.subject}
              onChange={(e) => setEmail({ ...email, subject: e.target.value })}
              placeholder={s.subjectOptional}
            />
            <Textarea
              value={email.body}
              onChange={(e) => setEmail({ ...email, body: e.target.value })}
              rows={2}
              placeholder={s.bodyOptional}
            />
          </TabsContent>
          <TabsContent value="tel">
            <Input
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              placeholder="+84 90 900 0000"
            />
          </TabsContent>
          <TabsContent value="sms">
            <Input
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              placeholder="+84 90 900 0000"
            />
          </TabsContent>
          <TabsContent value="wifi" className="space-y-2">
            <Input
              value={wifi.ssid}
              onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })}
              placeholder={s.ssid}
            />
            <Input
              value={wifi.password}
              onChange={(e) => setWifi({ ...wifi, password: e.target.value })}
              placeholder={s.wifiPassword}
              type="password"
            />
            <select
              value={wifi.encryption}
              onChange={(e) =>
                setWifi({ ...wifi, encryption: e.target.value as 'WPA' | 'WEP' | 'nopass' })
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="WPA">WPA/WPA2/WPA3</option>
              <option value="WEP">WEP</option>
              <option value="nopass">{s.wifiOpen}</option>
            </select>
          </TabsContent>
          <TabsContent value="vcard" className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={vcard.firstName}
                onChange={(e) => setVcard({ ...vcard, firstName: e.target.value })}
                placeholder={s.firstName}
              />
              <Input
                value={vcard.lastName}
                onChange={(e) => setVcard({ ...vcard, lastName: e.target.value })}
                placeholder={s.lastName}
              />
            </div>
            <Input
              value={vcard.org}
              onChange={(e) => setVcard({ ...vcard, org: e.target.value })}
              placeholder={s.organization}
            />
            <Input
              value={vcard.title}
              onChange={(e) => setVcard({ ...vcard, title: e.target.value })}
              placeholder={s.jobTitle}
            />
            <Input
              value={vcard.phone}
              onChange={(e) => setVcard({ ...vcard, phone: e.target.value })}
              placeholder={s.phone}
            />
            <Input
              value={vcard.email}
              onChange={(e) => setVcard({ ...vcard, email: e.target.value })}
              placeholder={s.email}
            />
            <Input
              value={vcard.url}
              onChange={(e) => setVcard({ ...vcard, url: e.target.value })}
              placeholder={s.website}
            />
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.errorCorrection}</span>
            <select
              value={ecc}
              onChange={(e) => setEcc(e.target.value as typeof ecc)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="L">L (~7%)</option>
              <option value="M">{s.eccDefault}</option>
              <option value="Q">Q (~25%)</option>
              <option value="H">{s.eccLogos}</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.darkColor}</span>
            <Input
              type="color"
              value={darkColor}
              onChange={(e) => setDarkColor(e.target.value)}
              className="h-10"
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.lightColor}</span>
            <Input
              type="color"
              value={lightColor}
              onChange={(e) => setLightColor(e.target.value)}
              className="h-10"
            />
          </label>
        </div>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {pngUrl && (
          <div className="flex flex-col items-center gap-3">
            {/* biome-ignore lint/performance/noImgElement: data URI, not optimizable by next/image */}
            <img src={pngUrl} alt={s.previewAlt} className="rounded border bg-white p-2 max-w-xs" />
            <div className="flex gap-2">
              <a
                href={pngUrl}
                download={`qr-${kind}-${Date.now()}.png`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {s.downloadPng}
              </a>
              <button
                type="button"
                onClick={downloadSvg}
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
              >
                {s.downloadSvg}
              </button>
            </div>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
