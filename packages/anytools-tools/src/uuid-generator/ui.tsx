'use client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@anytools/ui';
import { useState } from 'react';
import { type UuidVersion, formatUuid, generateUuid, inspectUuid } from './logic';

export function UuidGeneratorUi() {
  const [version, setVersion] = useState<UuidVersion>('v7');
  const [count, setCount] = useState(5);
  const [uppercase, setUppercase] = useState(false);
  const [dashes, setDashes] = useState(true);
  const [generated, setGenerated] = useState<string[]>([]);
  const [validateInput, setValidateInput] = useState('');

  const handleGenerate = () => {
    const next = generateUuid(version, Math.max(1, Math.min(count, 100)));
    setGenerated(next.map((u) => formatUuid(u, { uppercase, dashes })));
  };

  const inspection = validateInput ? inspectUuid(validateInput) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">UUID Generator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={version} onValueChange={(v) => setVersion(v as UuidVersion)}>
            <TabsList>
              <TabsTrigger value="v7">v7 (recommended)</TabsTrigger>
              <TabsTrigger value="v4">v4 (random)</TabsTrigger>
              <TabsTrigger value="v1">v1 (timestamp + MAC)</TabsTrigger>
            </TabsList>
            <TabsContent value="v7">
              <p className="text-xs text-muted-foreground">
                Sortable by time, recommended for new database keys.
              </p>
            </TabsContent>
            <TabsContent value="v4">
              <p className="text-xs text-muted-foreground">
                Fully random. Universally supported. Default for most libraries.
              </p>
            </TabsContent>
            <TabsContent value="v1">
              <p className="text-xs text-muted-foreground">
                Includes timestamp + node ID. Legacy; prefer v7.
              </p>
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-3 gap-3 items-end">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
            <label className="text-sm">
              <span className="block mb-1 text-muted-foreground">Count (1–100)</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(e) => setUppercase(e.target.checked)}
                className="h-4 w-4"
              />
              Uppercase
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dashes}
                onChange={(e) => setDashes(e.target.checked)}
                className="h-4 w-4"
              />
              Show dashes
            </label>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleGenerate}>Generate</Button>
            {generated.length > 0 && <CopyButton text={generated.join('\n')} />}
          </div>

          {generated.length > 0 && (
            <pre className="rounded-md border bg-muted p-3 text-sm font-mono whitespace-pre-wrap break-all">
              {generated.join('\n')}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validate a UUID</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={validateInput}
            onChange={(e) => setValidateInput(e.target.value)}
            placeholder="Paste a UUID to detect version"
          />
          {inspection && (
            <div className="flex gap-2 items-center text-sm">
              {inspection.valid ? (
                <>
                  <Badge>v{inspection.version}</Badge>
                  <span className="text-muted-foreground">Variant: {inspection.variant}</span>
                </>
              ) : (
                <Badge variant="destructive">Invalid UUID</Badge>
              )}
            </div>
          )}
          <PrivacyNote />
        </CardContent>
      </Card>
    </div>
  );
}
