'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  TableResult,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { calculateSubnet } from './logic';
import { STRINGS } from './strings';

export function IpSubnetCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [cidr, setCidr] = useState('192.168.1.0/24');
  const info = useMemo(() => calculateSubnet(cidr), [cidr]);
  const [hintBefore, hintAfter] = s.hint.split('{code}');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="block text-sm font-medium mb-1.5">{s.addressPrefix}</span>
          <Input
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="192.168.1.0/24"
            aria-label={s.cidrNotation}
            aria-invalid={info === null}
            className="h-11 font-mono"
          />
        </div>

        {info ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold font-mono">{info.cidr}</span>
              <CopyButton text={info.cidr} />
            </div>
            <TableResult
              rows={[
                { label: s.networkAddress, value: info.networkAddress },
                { label: s.broadcastAddress, value: info.broadcastAddress },
                { label: s.firstHost, value: info.firstHost },
                { label: s.lastHost, value: info.lastHost },
                { label: s.usableHosts, value: info.hostCount.toLocaleString(locale) },
                { label: s.totalAddresses, value: info.totalAddresses.toLocaleString(locale) },
                { label: s.netmask, value: info.netmask },
                { label: s.wildcardMask, value: info.wildcardMask },
                {
                  label: s.ipClass,
                  // D and E carry a note; logic labels it in English, the strings table here.
                  value:
                    info.ipClassLetter === 'D'
                      ? s.classMulticast
                      : info.ipClassLetter === 'E'
                        ? s.classReserved
                        : info.ipClassLetter,
                },
                { label: s.scope, value: info.isPrivate ? s.privateScope : s.publicScope },
              ]}
            />
            <div className="rounded-lg border p-3 font-mono text-xs space-y-1 overflow-x-auto">
              <p>
                <span className="text-muted-foreground">{s.binaryAddress} </span>
                {info.binaryAddress}
              </p>
              <p>
                <span className="text-muted-foreground">{s.binaryNetmask} </span>
                {info.binaryNetmask}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {hintBefore}
            <code>10.0.0.0/26</code>
            {hintAfter}
          </p>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
