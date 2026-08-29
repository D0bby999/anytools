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
} from '@anytools/ui';
import { useState } from 'react';
import { DEFAULT_ROUNDS, MAX_ROUNDS, MIN_ROUNDS, hashPassword, verifyPassword } from './logic';

export function BcryptGeneratorUi() {
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
        <CardTitle className="text-xl">Bcrypt Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="hash">
          <TabsList>
            <TabsTrigger value="hash">Hash</TabsTrigger>
            <TabsTrigger value="verify">Verify</TabsTrigger>
          </TabsList>

          <TabsContent value="hash" className="space-y-4">
            <div>
              <span className="block text-sm font-medium mb-1.5">Password</span>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password to hash"
                className="h-11 font-mono"
              />
            </div>
            <RangeSlider
              label={`Cost rounds: ${rounds} (2^${rounds} iterations)`}
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
              {hashing ? 'Hashing…' : 'Generate hash'}
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
              <span className="block text-sm font-medium mb-1.5">Password</span>
              <Input
                value={verifyPw}
                onChange={(e) => {
                  setVerifyPw(e.target.value);
                  setVerdict(null);
                }}
                aria-label="Password to verify"
                className="h-11 font-mono"
              />
            </div>
            <div>
              <span className="block text-sm font-medium mb-1.5">Existing bcrypt hash</span>
              <Textarea
                value={verifyHash}
                onChange={(e) => {
                  setVerifyHash(e.target.value);
                  setVerdict(null);
                }}
                rows={2}
                placeholder="$2b$10$…"
                aria-label="Bcrypt hash"
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
                {verifying ? 'Checking…' : 'Verify'}
              </Button>
              {verdict !== null && (
                <Badge
                  className={
                    verdict
                      ? 'bg-green-500/10 text-green-700 dark:text-green-300 border-0'
                      : 'bg-red-500/10 text-red-700 dark:text-red-300 border-0'
                  }
                >
                  {verdict ? 'Match ✓' : 'No match ✗'}
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
