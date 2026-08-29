'use client';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, Input, PrivacyNote, TableResult } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { calculateSubnet } from './logic';

export function IpSubnetCalculatorUi() {
  const [cidr, setCidr] = useState('192.168.1.0/24');
  const info = useMemo(() => calculateSubnet(cidr), [cidr]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">IP Subnet Calculator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="block text-sm font-medium mb-1.5">IPv4 address / prefix</span>
          <Input
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="192.168.1.0/24"
            aria-label="CIDR notation"
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
                { label: 'Network address', value: info.networkAddress },
                { label: 'Broadcast address', value: info.broadcastAddress },
                { label: 'First usable host', value: info.firstHost },
                { label: 'Last usable host', value: info.lastHost },
                { label: 'Usable hosts', value: info.hostCount.toLocaleString('en-US') },
                { label: 'Total addresses', value: info.totalAddresses.toLocaleString('en-US') },
                { label: 'Netmask', value: info.netmask },
                { label: 'Wildcard mask', value: info.wildcardMask },
                { label: 'IP class', value: info.ipClass },
                { label: 'Scope', value: info.isPrivate ? 'Private (RFC 1918)' : 'Public' },
              ]}
            />
            <div className="rounded-lg border p-3 font-mono text-xs space-y-1 overflow-x-auto">
              <p>
                <span className="text-muted-foreground">address </span>
                {info.binaryAddress}
              </p>
              <p>
                <span className="text-muted-foreground">netmask </span>
                {info.binaryNetmask}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter CIDR like <code>10.0.0.0/26</code> (prefix 0–32).
          </p>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
