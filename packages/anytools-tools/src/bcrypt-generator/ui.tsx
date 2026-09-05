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
  RangeSlider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
} from '@anytools/ui';
import { useState } from 'react';
import { DEFAULT_ROUNDS, MAX_ROUNDS, MIN_ROUNDS, hashPassword, verifyPassword } from './logic';
import { STRINGS } from './strings';

export function BcryptGeneratorUi() {
  const s = useLocalized(STRINGS);
  const [password, setPassword] = useState('');
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [hash, setHash] = useState('');
  const [hashing, setHashing] = useState(false);

  const [verifyPw, setVerifyPw] = useState('');
  const [verifyHash, setVerifyHash] = useState('');
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const [verifying, setVerifying] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="hash">
          <TabsList>
            <TabsTrigger value="hash">{s.tabHash}</TabsTrigger>
            <TabsTrigger value="verify">{s.tabVerify}</TabsTrigger>
          </TabsList>

          <TabsContent value="hash" className="space-y-4">
            <div>
              <span className="block text-sm font-medium mb-1.5">{s.password}</span>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label={s.passwordToHash}
                className="h-11 font-mono"
              />
            </div>
            <RangeSlider
              label={s.costRounds.split('{n}').join(String(rounds))}
              min={MIN_ROUNDS}
              max={MAX_ROUNDS}
              step={1}
              value={rounds}
              onChange={setRounds}
            />
            <Button
              disabled={!password || hashing}
              onClick={async () => {
                setHashing(true);
                try {
                  setHash(await hashPassword(password, rounds));
                } finally {
                  setHashing(false);
                }
              }}
            >
              {hashing ? s.hashing : s.generateHash}
            </Button>
            {hash && (
              <div className="flex items-start gap-2 rounded-lg border p-3">
                <code className="font-mono text-sm break-all flex-1">{hash}</code>
                <CopyButton text={hash} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="verify" className="space-y-4">
            <div>
              <span className="block text-sm font-medium mb-1.5">{s.password}</span>
              <Input
                value={verifyPw}
                onChange={(e) => {
                  setVerifyPw(e.target.value);
                  setVerdict(null);
                }}
                aria-label={s.passwordToVerify}
                className="h-11 font-mono"
              />
            </div>
            <div>
              <span className="block text-sm font-medium mb-1.5">{s.existingHash}</span>
              <Textarea
                value={verifyHash}
                onChange={(e) => {
                  setVerifyHash(e.target.value);
                  setVerdict(null);
                }}
                rows={2}
                placeholder="$2b$10$…"
                aria-label={s.bcryptHash}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={!verifyPw || !verifyHash || verifying}
                onClick={async () => {
                  setVerifying(true);
                  try {
                    setVerdict(await verifyPassword(verifyPw, verifyHash));
                  } finally {
                    setVerifying(false);
                  }
                }}
              >
                {verifying ? s.checking : s.tabVerify}
              </Button>
              {verdict !== null && (
                <Badge
                  className={
                    verdict
                      ? 'bg-success/10 text-success border-0'
                      : 'bg-destructive/10 text-destructive border-0'
                  }
                >
                  {verdict ? s.match : s.noMatch}
                </Badge>
              )}
            </div>
          </TabsContent>
        </Tabs>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
