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
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useState } from 'react';
import { type UuidVersion, formatUuid, generateUuid, inspectUuid } from './logic';
import { STRINGS } from './strings';

export function UuidGeneratorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
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
  // Variant ids come from the logic layer; name them in the locale.
  const variantLabel: Record<string, string> = {
    ncs: s.variant_ncs,
    rfc4122: s.variant_rfc4122,
    microsoft: s.variant_microsoft,
    reserved: s.variant_reserved,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{s.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={version} onValueChange={(v) => setVersion(v as UuidVersion)}>
            <TabsList>
              <TabsTrigger value="v7">{s.v7}</TabsTrigger>
              <TabsTrigger value="v4">{s.v4}</TabsTrigger>
              <TabsTrigger value="v1">{s.v1}</TabsTrigger>
            </TabsList>
            <TabsContent value="v7">
              <p className="text-xs text-muted-foreground">{s.v7Note}</p>
            </TabsContent>
            <TabsContent value="v4">
              <p className="text-xs text-muted-foreground">{s.v4Note}</p>
            </TabsContent>
            <TabsContent value="v1">
              <p className="text-xs text-muted-foreground">{s.v1Note}</p>
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-3 gap-3 items-end">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
            <label className="text-sm">
              <span className="block mb-1 text-muted-foreground">{s.count}</span>
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
              {ui.uppercase}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dashes}
                onChange={(e) => setDashes(e.target.checked)}
                className="h-4 w-4"
              />
              {s.showDashes}
            </label>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleGenerate}>{ui.generate}</Button>
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
          <CardTitle className="text-base">{s.validateTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={validateInput}
            onChange={(e) => setValidateInput(e.target.value)}
            placeholder={s.validatePlaceholder}
          />
          {inspection && (
            <div className="flex gap-2 items-center text-sm">
              {inspection.valid ? (
                <>
                  <Badge>v{inspection.version}</Badge>
                  <span className="text-muted-foreground">
                    {s.variant.replace(
                      '{v}',
                      variantLabel[inspection.variantId] ?? inspection.variant,
                    )}
                  </span>
                </>
              ) : (
                <Badge variant="destructive">{s.invalidUuid}</Badge>
              )}
            </div>
          )}
          <PrivacyNote />
        </CardContent>
      </Card>
    </div>
  );
}
