import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE_ROOT = join(tmpdir(), `anytools-tool-test-${Date.now()}`);
process.env.CONTENT_ROOT = FIXTURE_ROOT;

const { loadToolContent } = await import('./load-tool-content');

const TUTORIAL = `---
title: "BMI Calculator Tutorial"
---

## How to use

Enter weight in kg and height in cm.
`;

const FAQ = `---
title: "BMI FAQ"
---

## What is BMI?
Body Mass Index is weight divided by height squared.

## Is BMI accurate?
It's a screening tool, not a diagnosis.

## Should children use it?
Different chart applies; consult a pediatrician.
`;

beforeAll(async () => {
  const base = join(FIXTURE_ROOT, 'en', 'tools', 'health');
  await mkdir(base, { recursive: true });
  await writeFile(join(base, 'bmi-calculator-tutorial.mdx'), TUTORIAL, 'utf-8');
  await writeFile(join(base, 'bmi-calculator-faq.mdx'), FAQ, 'utf-8');
});

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('loadToolContent', () => {
  it('loads both tutorial and FAQ when present', async () => {
    const out = await loadToolContent('en', 'health', 'bmi-calculator');
    expect(out.tutorial).toBeDefined();
    expect(out.tutorial?.source).toContain('Enter weight in kg');
    expect(out.faq).toBeDefined();
  });

  it('parses FAQ into Q/A pairs by ## sections', async () => {
    const out = await loadToolContent('en', 'health', 'bmi-calculator');
    expect(out.faq?.items).toHaveLength(3);
    expect(out.faq?.items[0]).toEqual({
      q: 'What is BMI?',
      a: 'Body Mass Index is weight divided by height squared.',
    });
    expect(out.faq?.items[2]?.q).toBe('Should children use it?');
  });

  it('returns empty fields gracefully when tool has no content (no crash)', async () => {
    const out = await loadToolContent('en', 'health', 'nonexistent-tool');
    expect(out.tutorial).toBeUndefined();
    expect(out.faq).toBeUndefined();
  });

  it('returns empty fields when locale folder absent', async () => {
    const out = await loadToolContent('vi', 'health', 'bmi-calculator');
    expect(out.tutorial).toBeUndefined();
    expect(out.faq).toBeUndefined();
  });

  it('loads tutorial only when FAQ is missing', async () => {
    const base = join(FIXTURE_ROOT, 'en', 'tools', 'lifestyle');
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'tip-calculator-tutorial.mdx'), TUTORIAL, 'utf-8');
    const out = await loadToolContent('en', 'lifestyle', 'tip-calculator');
    expect(out.tutorial).toBeDefined();
    expect(out.faq).toBeUndefined();
  });
});
