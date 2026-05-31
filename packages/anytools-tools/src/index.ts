import base64Encode from './base64-encode';
import cronParser from './cron-parser';
import csvJson from './csv-json';
import curlConverter from './curl-converter';
import diffChecker from './diff-checker';
import ethWeiConverter from './eth-wei-converter';
import hashGenerator from './hash-generator';
import htmlEntity from './html-entity';
import jsonFormatter from './json-formatter';
import jsonYamlToml from './json-yaml-toml';
import jwtDecoder from './jwt-decoder';
import mdHtml from './md-html';
import mockDataGenerator from './mock-data-generator';
import passwordGenerator from './password-generator';
import regexTester from './regex-tester';
import slugify from './slugify';
import sqlFormatter from './sql-formatter';
import textCaseConverter from './text-case-converter';
import timestampConverter from './timestamp-converter';
import timezoneConverter from './timezone-converter';
import type { Tool } from './types';
import urlEncode from './url-encode';
import uuidGenerator from './uuid-generator';
import walletChecker from './wallet-checker';
import xmlFormatter from './xml-formatter';
import yamlFormatter from './yaml-formatter';

/**
 * Tool registry. Each tool exports a default Tool object.
 * Add new tools by importing here and appending to the array.
 */
export const tools: Tool[] = [
  // Phase 1 — 10 tools
  base64Encode,
  urlEncode,
  jwtDecoder,
  uuidGenerator,
  hashGenerator,
  passwordGenerator,
  timestampConverter,
  jsonFormatter,
  sqlFormatter,
  regexTester,
  // Phase 2 — 15 tools
  textCaseConverter,
  slugify,
  htmlEntity,
  mockDataGenerator,
  jsonYamlToml,
  csvJson,
  mdHtml,
  diffChecker,
  curlConverter,
  cronParser,
  timezoneConverter,
  xmlFormatter,
  yamlFormatter,
  walletChecker,
  ethWeiConverter,
];

export function getTool(cluster: string, slug: string): Tool | undefined {
  return tools.find((t) => t.meta.cluster === cluster && t.meta.slug === slug);
}

export function getToolsByCluster(cluster: string): Tool[] {
  return tools.filter((t) => t.meta.cluster === cluster);
}

export type * from './types';
