/**
 * ui-registry.ts
 * Which tools have a working UI here, and how to load it.
 *
 * One dynamic import per tool, so each tool's UI and its dependencies (ethers,
 * cron-parser, later pdf-lib and the wasm encoders) are their own chunk and
 * reach only that tool's page. The catalog, the sitemap and search read
 * meta-registry.ts, which pulls in no UI at all.
 *
 * A tool in the registry but not here still has its page, which says it is
 * coming back soon, and stays out of the sitemap. Phase 3 ports the rest by
 * appending a line per tool.
 */
import type { ComponentType } from "react";
import type { Tool } from "./types";

type ToolModule = { default: Tool };

export const TOOL_UIS: Record<string, () => Promise<ToolModule>> = {
  // time-date
  "cron-parser": () => import("./cron-parser"),
  "crontab-generator": () => import("./crontab-generator"),
  "discord-timestamp-generator": () => import("./discord-timestamp-generator"),
  "timestamp-converter": () => import("./timestamp-converter"),
  "timezone-converter": () => import("./timezone-converter"),
  // web3
  "bip39-mnemonic": () => import("./bip39-mnemonic"),
  "eth-wei-converter": () => import("./eth-wei-converter"),
  "wallet-checker": () => import("./wallet-checker"),
  // --- batch A (phase 3a): converters, finance, health, lifestyle ---
  // converters
  "audio-trim": () => import("./audio-trim"),
  "chmod-calculator": () => import("./chmod-calculator"),
  "create-zip": () => import("./create-zip"),
  "csv-json": () => import("./csv-json"),
  "curl-converter": () => import("./curl-converter"),
  "docx-to-markdown": () => import("./docx-to-markdown"),
  "font-converter": () => import("./font-converter"),
  "image-format-converter": () => import("./image-format-converter"),
  "image-to-base64": () => import("./image-to-base64"),
  "ip-subnet-calculator": () => import("./ip-subnet-calculator"),
  "json-yaml-toml": () => import("./json-yaml-toml"),
  "md-html": () => import("./md-html"),
  "msgpack-decoder": () => import("./msgpack-decoder"),
  "protobuf-decoder": () => import("./protobuf-decoder"),
  "roman-numeral-converter": () => import("./roman-numeral-converter"),
  "unzip-archive": () => import("./unzip-archive"),
  "xlsx-to-csv": () => import("./xlsx-to-csv"),
  // finance
  "compound-interest": () => import("./compound-interest"),
  "currency-converter": () => import("./currency-converter"),
  "discount-calculator": () => import("./discount-calculator"),
  "loan-calculator": () => import("./loan-calculator"),
  "mortgage-calculator": () => import("./mortgage-calculator"),
  "retirement-calculator": () => import("./retirement-calculator"),
  "sales-tax-calculator": () => import("./sales-tax-calculator"),
  "tip-calculator": () => import("./tip-calculator"),
  "tip-to-hourly-wage": () => import("./tip-to-hourly-wage"),
  // health
  "bmi-calculator": () => import("./bmi-calculator"),
  "bmr-calculator": () => import("./bmr-calculator"),
  "body-fat-calculator": () => import("./body-fat-calculator"),
  "calorie-calculator": () => import("./calorie-calculator"),
  "pace-calculator": () => import("./pace-calculator"),
  "pregnancy-due-date": () => import("./pregnancy-due-date"),
  "sleep-calculator": () => import("./sleep-calculator"),
  // lifestyle
  "age-calculator": () => import("./age-calculator"),
  "date-diff": () => import("./date-diff"),
  "gpa-calculator": () => import("./gpa-calculator"),
  "grade-calculator": () => import("./grade-calculator"),
  "percentage-calculator": () => import("./percentage-calculator"),
  "pomodoro-timer": () => import("./pomodoro-timer"),
  "random-picker": () => import("./random-picker"),
  "readability-analyzer": () => import("./readability-analyzer"),
  "reading-time": () => import("./reading-time"),
  "scientific-calculator": () => import("./scientific-calculator"),
  "shoe-size-converter": () => import("./shoe-size-converter"),
  "statistics-calculator": () => import("./statistics-calculator"),
  "time-card-calculator": () => import("./time-card-calculator"),
  "triangle-calculator": () => import("./triangle-calculator"),
  "unit-converter": () => import("./unit-converter"),
  "word-counter": () => import("./word-counter"),
  // encoding
  "aes-text-encrypt": () => import("./aes-text-encrypt"),
  "base64-encode": () => import("./base64-encode"),
  "binary-encode": () => import("./binary-encode"),
  "hex-encode": () => import("./hex-encode"),
  "html-entity": () => import("./html-entity"),
  "http-status-codes": () => import("./http-status-codes"),
  "integer-base-converter": () => import("./integer-base-converter"),
  "jwt-decoder": () => import("./jwt-decoder"),
  "jwt-sign-verify": () => import("./jwt-sign-verify"),
  "unicode-escape": () => import("./unicode-escape"),
  "url-encode": () => import("./url-encode"),
  "x509-certificate-decoder": () => import("./x509-certificate-decoder"),
  // formatters
  "css-beautifier": () => import("./css-beautifier"),
  "html-beautifier": () => import("./html-beautifier"),
  "jq-playground": () => import("./jq-playground"),
  "js-beautifier": () => import("./js-beautifier"),
  "json-diff": () => import("./json-diff"),
  "json-formatter": () => import("./json-formatter"),
  "json-schema-validator": () => import("./json-schema-validator"),
  "sql-formatter": () => import("./sql-formatter"),
  "sql-playground": () => import("./sql-playground"),
  "xml-formatter": () => import("./xml-formatter"),
  "yaml-formatter": () => import("./yaml-formatter"),
  // generators
  "barcode-generator": () => import("./barcode-generator"),
  "bcrypt-generator": () => import("./bcrypt-generator"),
  "hash-generator": () => import("./hash-generator"),
  "hmac-generator": () => import("./hmac-generator"),
  "lorem-ipsum-generator": () => import("./lorem-ipsum-generator"),
  "meta-tag-generator": () => import("./meta-tag-generator"),
  "mock-data-generator": () => import("./mock-data-generator"),
  "password-generator": () => import("./password-generator"),
  "qr-code-generator": () => import("./qr-code-generator"),
  "rsa-keypair-generator": () => import("./rsa-keypair-generator"),
  "totp-generator": () => import("./totp-generator"),
  "uuid-generator": () => import("./uuid-generator"),
  // text-regex
  "diff-checker": () => import("./diff-checker"),
  "regex-tester": () => import("./regex-tester"),
  "slugify": () => import("./slugify"),
  "text-case-converter": () => import("./text-case-converter"),
  "token-counter": () => import("./token-counter"),
  "unicode-cleaner": () => import("./unicode-cleaner"),
  "url-parser": () => import("./url-parser"),
  "user-agent-parser": () => import("./user-agent-parser"),
  // design
  "box-shadow-generator": () => import("./box-shadow-generator"),
  "clip-path-generator": () => import("./clip-path-generator"),
  "color-blindness-simulator": () => import("./color-blindness-simulator"),
  "color-converter": () => import("./color-converter"),
  "color-palette": () => import("./color-palette"),
  "css-gradient-generator": () => import("./css-gradient-generator"),
  "cubic-bezier-generator": () => import("./cubic-bezier-generator"),
  "stl-obj-viewer": () => import("./stl-obj-viewer"),
  "wcag-contrast-checker": () => import("./wcag-contrast-checker"),
  "whiteboard": () => import("./whiteboard"),
  // image
  "compress-image": () => import("./compress-image"),
  "crop-image": () => import("./crop-image"),
  "heic-to-jpg": () => import("./heic-to-jpg"),
  "ocr-image-to-text": () => import("./ocr-image-to-text"),
  "qr-barcode-scanner": () => import("./qr-barcode-scanner"),
  "remove-background": () => import("./remove-background"),
  "resize-image": () => import("./resize-image"),
  "rotate-image": () => import("./rotate-image"),
  "watermark-image": () => import("./watermark-image"),
  // pdf
  "add-page-numbers": () => import("./add-page-numbers"),
  "compress-pdf": () => import("./compress-pdf"),
  "extract-images-from-pdf": () => import("./extract-images-from-pdf"),
  "image-to-pdf": () => import("./image-to-pdf"),
  "merge-pdf": () => import("./merge-pdf"),
  "ocr-pdf": () => import("./ocr-pdf"),
  "pdf-password": () => import("./pdf-password"),
  "pdf-to-png": () => import("./pdf-to-png"),
  "remove-pdf-pages": () => import("./remove-pdf-pages"),
  "rotate-pdf": () => import("./rotate-pdf"),
  "split-pdf": () => import("./split-pdf"),
  "watermark-pdf": () => import("./watermark-pdf"),
};

export function isPorted(slug: string): boolean {
  return Object.hasOwn(TOOL_UIS, slug);
}

/** The tool's component, for React.lazy. */
export async function loadToolUi(slug: string): Promise<{ default: ComponentType }> {
  const load = TOOL_UIS[slug];
  if (!load) throw new Error(`no UI for ${slug}`);
  const mod = await load();
  return { default: mod.default.Component };
}
