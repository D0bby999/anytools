#!/usr/bin/env node
/**
 * scripts/rankings/monthly-update.mjs
 * Validates and refreshes the monthly user-first rankings in `content/rankings/*.json`.
 *
 * Modes:
 *   node scripts/rankings/monthly-update.mjs --check
 *     Validates schema, 4-locale parity (en, vi, es, pt), weighted userScore,
 *     1-based rank order, unique affiliate slugs, and HTTPS affiliate URLs.
 *
 *   node scripts/rankings/monthly-update.mjs --month YYYY-MM [--date YYYY-MM-DD]
 *     Recomputes each item's weighted userScore from its 4 criteria, sorts items
 *     by userScore descending, computes `rankDelta` from the previous `rank`,
 *     updates `month` and `updated`, writes the JSON files, and prints a summary.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIR = join(ROOT, "content/rankings");
const LOCALES = ["en", "vi", "es", "pt"];
const CRITERIA = ["performance", "value", "reliability", "support"];
const WEIGHTS = { performance: 0.35, value: 0.3, reliability: 0.2, support: 0.15 };

function computeScore(c) {
  const raw =
    c.performance * WEIGHTS.performance +
    c.value * WEIGHTS.value +
    c.reliability * WEIGHTS.reliability +
    c.support * WEIGHTS.support;
  return Math.round(raw * 10) / 10;
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const monthIdx = args.indexOf("--month");
const dateIdx = args.indexOf("--date");
const nextMonth = monthIdx >= 0 ? args[monthIdx + 1] : null;
const nextDate = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);

if (!checkOnly && (!nextMonth || !/^\d{4}-\d{2}$/.test(nextMonth))) {
  console.error("Usage: node scripts/rankings/monthly-update.mjs --check | --month YYYY-MM [--date YYYY-MM-DD]");
  process.exit(2);
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("No ranking category files found in content/rankings/");
  process.exit(1);
}

const seenItemSlugs = new Set();
const errors = [];
const reportLines = [];

for (const file of files) {
  const fullPath = join(DIR, file);
  const raw = JSON.parse(readFileSync(fullPath, "utf8"));
  const expectedSlug = file.replace(/\.json$/, "");

  if (raw.slug !== expectedSlug) {
    errors.push(`${file}: slug "${raw.slug}" does not match filename "${expectedSlug}"`);
  }
  if (!/^\d{4}-\d{2}$/.test(raw.month ?? "")) {
    errors.push(`${file}: invalid month "${raw.month}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.updated ?? "")) {
    errors.push(`${file}: invalid updated date "${raw.updated}"`);
  }

  for (const l of LOCALES) {
    const loc = raw.locales?.[l];
    if (!loc) {
      errors.push(`${file}: missing locale "${l}"`);
      continue;
    }
    for (const field of ["title", "tagline", "description", "methodologyNote", "monthlySummary"]) {
      if (typeof loc[field] !== "string" || !loc[field].trim()) {
        errors.push(`${file} [${l}]: missing "${field}"`);
      }
    }
    for (const c of CRITERIA) {
      if (typeof loc.criteriaLabels?.[c] !== "string" || !loc.criteriaLabels[c].trim()) {
        errors.push(`${file} [${l}]: missing criteriaLabels.${c}`);
      }
    }
    if (!Array.isArray(loc.buyingGuide) || loc.buyingGuide.length === 0) {
      errors.push(`${file} [${l}]: buyingGuide must be a non-empty array`);
    }
    if (!Array.isArray(loc.faqs) || loc.faqs.length === 0) {
      errors.push(`${file} [${l}]: faqs must be a non-empty array`);
    }
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    errors.push(`${file}: items must be a non-empty array`);
    continue;
  }

  // Validate each item
  for (const item of raw.items) {
    if (!/^[a-z0-9-]+$/.test(item.slug ?? "")) {
      errors.push(`${file}: invalid item slug "${item.slug}"`);
    }
    if (seenItemSlugs.has(item.slug)) {
      errors.push(`${file}: duplicate item slug "${item.slug}" across categories`);
    }
    seenItemSlugs.add(item.slug);

    for (const c of CRITERIA) {
      const v = item.criteria?.[c];
      if (typeof v !== "number" || v < 0 || v > 10) {
        errors.push(`${file} (${item.slug}): invalid criterion "${c}" = ${v}`);
      }
    }

    try {
      const u = new URL(item.affiliateUrl);
      if (u.protocol !== "https:") {
        errors.push(`${file} (${item.slug}): affiliateUrl must use https:`);
      }
    } catch {
      errors.push(`${file} (${item.slug}): invalid affiliateUrl "${item.affiliateUrl}"`);
    }

    for (const l of LOCALES) {
      const iloc = item.locales?.[l];
      if (!iloc) {
        errors.push(`${file} (${item.slug}): missing locale "${l}"`);
        continue;
      }
      if (!iloc.bestFor?.trim() || !iloc.summary?.trim()) {
        errors.push(`${file} (${item.slug}) [${l}]: missing bestFor or summary`);
      }
      if (!Array.isArray(iloc.pros) || iloc.pros.length === 0) {
        errors.push(`${file} (${item.slug}) [${l}]: pros must be non-empty`);
      }
      if (!Array.isArray(iloc.cons) || iloc.cons.length === 0) {
        errors.push(`${file} (${item.slug}) [${l}]: cons must be non-empty`);
      }
    }
  }

  // Check or recompute rank order by userScore descending
  const scored = raw.items.map((item) => ({
    item,
    score: computeScore(item.criteria),
    prevRank: item.rank,
  }));
  scored.sort((a, b) => b.score - a.score || a.prevRank - b.prevRank);

  if (checkOnly) {
    scored.forEach((entry, idx) => {
      const expectedRank = idx + 1;
      if (entry.item.rank !== expectedRank) {
        errors.push(
          `${file} (${entry.item.slug}): rank is ${entry.item.rank}, but score ${entry.score} places it at #${expectedRank}`,
        );
      }
    });
  } else {
    const monthChanged = raw.month !== nextMonth;
    raw.month = nextMonth;
    raw.updated = nextDate;
    raw.items = scored.map((entry, idx) => {
      const newRank = idx + 1;
      const delta = monthChanged
        ? typeof entry.prevRank === "number"
          ? entry.prevRank - newRank
          : "new"
        : entry.item.rankDelta;
      reportLines.push(
        `${raw.slug}: #${newRank} ${entry.item.name} (${entry.score.toFixed(1)}/10, delta: ${delta})`,
      );
      return {
        ...entry.item,
        rank: newRank,
        rankDelta: delta,
      };
    });
    writeFileSync(fullPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }
}

if (errors.length > 0) {
  console.error("Rankings validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(`OK: ${files.length} ranking categories (${seenItemSlugs.size} items) validated across ${LOCALES.join(", ")}.`);
} else {
  console.log(`Updated ${files.length} categories for ${nextMonth} (${nextDate}):`);
  for (const line of reportLines) console.log(`  ${line}`);
}

