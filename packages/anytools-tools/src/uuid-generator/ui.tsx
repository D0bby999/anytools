'use client';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  GeneratorTemplate,
  Input,
  Label,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useId, useState } from 'react';
import { type UuidVersion, formatUuid, generateUuid, inspectUuid } from './logic';
import { STRINGS } from './strings';

export function UuidGeneratorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const countId = useId();
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
    <div className="space-y-6">
      <GeneratorTemplate
        title={s.title}
        primaryActionLabel={ui.generate}
        onGenerate={handleGenerate}
        output={generated.join('\n')}
        form={
          <>
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

            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={countId}>{s.count}</Label>
                <Input
                  id={countId}
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </div>
              <CheckboxField
                label={ui.uppercase}
                checked={uppercase}
                onCheckedChange={(v) => setUppercase(v === true)}
              />
              <CheckboxField
                label={s.showDashes}
                checked={dashes}
                onCheckedChange={(v) => setDashes(v === true)}
              />
            </div>
          </>
        }
        outputDisplay={
          generated.length > 0 ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-sm">
              {generated.join('\n')}
            </pre>
          ) : (
            <span className="text-sm italic text-muted-foreground">{ui.waitingForInput}</span>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{s.validateTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={validateInput}
            onChange={(e) => setValidateInput(e.target.value)}
            placeholder={s.validatePlaceholder}
            aria-label={s.validateTitle}
          />
          {inspection && (
            <div className="flex items-center gap-2 text-sm">
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
