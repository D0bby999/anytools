/**
 * Metadata-only registry. Importing this does NOT pull tool UI components or
 * their heavy deps (ethers, faker, sql-formatter, etc.) into the bundle.
 * Use for sitemap, catalog page, Cmd+K, workflow-chain — anywhere that needs
 * tool listings without rendering the tool itself.
 */
import { meta as addPageNumbers } from './add-page-numbers/meta';
import { meta as ageCalculator } from './age-calculator/meta';
import { meta as barcodeGenerator } from './barcode-generator/meta';
import { meta as base64Encode } from './base64-encode/meta';
import { meta as bcryptGenerator } from './bcrypt-generator/meta';
import { meta as binaryEncode } from './binary-encode/meta';
import { meta as bmiCalculator } from './bmi-calculator/meta';
import { meta as bmrCalculator } from './bmr-calculator/meta';
import { meta as bodyFatCalculator } from './body-fat-calculator/meta';
import { meta as boxShadowGenerator } from './box-shadow-generator/meta';
import { meta as calorieCalculator } from './calorie-calculator/meta';
import { meta as chmodCalculator } from './chmod-calculator/meta';
import { meta as clipPathGenerator } from './clip-path-generator/meta';
import { meta as colorConverter } from './color-converter/meta';
import { meta as colorPalette } from './color-palette/meta';
import { meta as compoundInterest } from './compound-interest/meta';
import { meta as compressImage } from './compress-image/meta';
import { meta as createZip } from './create-zip/meta';
import { meta as cronParser } from './cron-parser/meta';
import { meta as crontabGenerator } from './crontab-generator/meta';
import { meta as cropImage } from './crop-image/meta';
import { meta as cssBeautifier } from './css-beautifier/meta';
import { meta as cssGradientGenerator } from './css-gradient-generator/meta';
import { meta as csvJson } from './csv-json/meta';
import { meta as curlConverter } from './curl-converter/meta';
import { meta as currencyConverter } from './currency-converter/meta';
import { meta as dateDiff } from './date-diff/meta';
import { meta as diffChecker } from './diff-checker/meta';
import { meta as discountCalculator } from './discount-calculator/meta';
import { meta as ethWeiConverter } from './eth-wei-converter/meta';
import { meta as extractImagesFromPdf } from './extract-images-from-pdf/meta';
import { meta as gpaCalculator } from './gpa-calculator/meta';
import { meta as gradeCalculator } from './grade-calculator/meta';
import { meta as hashGenerator } from './hash-generator/meta';
import { meta as hexEncode } from './hex-encode/meta';
import { meta as htmlBeautifier } from './html-beautifier/meta';
import { meta as htmlEntity } from './html-entity/meta';
import { meta as httpStatusCodes } from './http-status-codes/meta';
import { meta as imageFormatConverter } from './image-format-converter/meta';
import { meta as imageToPdf } from './image-to-pdf/meta';
import { meta as integerBaseConverter } from './integer-base-converter/meta';
import { meta as ipSubnetCalculator } from './ip-subnet-calculator/meta';
import { meta as jsBeautifier } from './js-beautifier/meta';
import { meta as jsonDiff } from './json-diff/meta';
import { meta as jsonFormatter } from './json-formatter/meta';
import { meta as jsonYamlToml } from './json-yaml-toml/meta';
import { meta as jwtDecoder } from './jwt-decoder/meta';
import { meta as loanCalculator } from './loan-calculator/meta';
import { meta as loremIpsumGenerator } from './lorem-ipsum-generator/meta';
import { meta as mdHtml } from './md-html/meta';
import { meta as mergePdf } from './merge-pdf/meta';
import { meta as metaTagGenerator } from './meta-tag-generator/meta';
import { meta as mockDataGenerator } from './mock-data-generator/meta';
import { meta as mortgageCalculator } from './mortgage-calculator/meta';
import { meta as paceCalculator } from './pace-calculator/meta';
import { meta as passwordGenerator } from './password-generator/meta';
import { meta as pdfToPng } from './pdf-to-png/meta';
import { meta as percentageCalculator } from './percentage-calculator/meta';
import { meta as pomodoroTimer } from './pomodoro-timer/meta';
import { meta as pregnancyDueDate } from './pregnancy-due-date/meta';
import { meta as qrBarcodeScanner } from './qr-barcode-scanner/meta';
import { meta as qrCodeGenerator } from './qr-code-generator/meta';
import { meta as randomPicker } from './random-picker/meta';
import { meta as readabilityAnalyzer } from './readability-analyzer/meta';
import { meta as readingTime } from './reading-time/meta';
import { meta as regexTester } from './regex-tester/meta';
import { meta as removePdfPages } from './remove-pdf-pages/meta';
import { meta as resizeImage } from './resize-image/meta';
import { meta as retirementCalculator } from './retirement-calculator/meta';
import { meta as romanNumeralConverter } from './roman-numeral-converter/meta';
import { meta as rotatePdf } from './rotate-pdf/meta';
import { meta as salesTaxCalculator } from './sales-tax-calculator/meta';
import { meta as scientificCalculator } from './scientific-calculator/meta';
import { meta as shoeSizeConverter } from './shoe-size-converter/meta';
import { meta as sleepCalculator } from './sleep-calculator/meta';
import { meta as slugify } from './slugify/meta';
import { meta as splitPdf } from './split-pdf/meta';
import { meta as sqlFormatter } from './sql-formatter/meta';
import { meta as statisticsCalculator } from './statistics-calculator/meta';
import { meta as textCaseConverter } from './text-case-converter/meta';
import { meta as timeCardCalculator } from './time-card-calculator/meta';
import { meta as timestampConverter } from './timestamp-converter/meta';
import { meta as timezoneConverter } from './timezone-converter/meta';
import { meta as tipCalculator } from './tip-calculator/meta';
import { meta as tipToHourlyWage } from './tip-to-hourly-wage/meta';
import { meta as totpGenerator } from './totp-generator/meta';
import { meta as triangleCalculator } from './triangle-calculator/meta';
import type { ToolMeta } from './types';
import { meta as unicodeEscape } from './unicode-escape/meta';
import { meta as unitConverter } from './unit-converter/meta';
import { meta as unzipArchive } from './unzip-archive/meta';
import { meta as urlEncode } from './url-encode/meta';
import { meta as urlParser } from './url-parser/meta';
import { meta as userAgentParser } from './user-agent-parser/meta';
import { meta as uuidGenerator } from './uuid-generator/meta';
import { meta as walletChecker } from './wallet-checker/meta';
import { meta as watermarkPdf } from './watermark-pdf/meta';
import { meta as wcagContrastChecker } from './wcag-contrast-checker/meta';
import { meta as wordCounter } from './word-counter/meta';
import { meta as xlsxToCsv } from './xlsx-to-csv/meta';
import { meta as xmlFormatter } from './xml-formatter/meta';
import { meta as yamlFormatter } from './yaml-formatter/meta';

export const toolMetas: ToolMeta[] = [
  mergePdf,
  pdfToPng,
  extractImagesFromPdf,
  imageToPdf,
  addPageNumbers,
  watermarkPdf,
  integerBaseConverter,
  urlParser,
  userAgentParser,
  romanNumeralConverter,
  metaTagGenerator,
  compressImage,
  resizeImage,
  cropImage,
  createZip,
  unzipArchive,
  barcodeGenerator,
  qrBarcodeScanner,
  splitPdf,
  rotatePdf,
  removePdfPages,
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
  // Phase 2.5 — universal expansion
  qrCodeGenerator,
  loremIpsumGenerator,
  htmlBeautifier,
  cssBeautifier,
  jsBeautifier,
  // Phase 2.6 — encoding triplet + image format
  hexEncode,
  binaryEncode,
  unicodeEscape,
  imageFormatConverter,
  // Phase 3 — Tier-1 general-public MVP (8 tools, dark-launched until Phase 4 i18n)
  bmiCalculator,
  tipCalculator,
  ageCalculator,
  percentageCalculator,
  gpaCalculator,
  compoundInterest,
  colorConverter,
  unitConverter,
  // Phase 5 — Tier-2 expansion (16 tools)
  bmrCalculator,
  calorieCalculator,
  bodyFatCalculator,
  paceCalculator,
  dateDiff,
  discountCalculator,
  sleepCalculator,
  wordCounter,
  readingTime,
  randomPicker,
  mortgageCalculator,
  loanCalculator,
  scientificCalculator,
  statisticsCalculator,
  colorPalette,
  currencyConverter,
  // Phase 6 — Tier-3 stretch (10 tools)
  salesTaxCalculator,
  retirementCalculator,
  gradeCalculator,
  pregnancyDueDate,
  timeCardCalculator,
  triangleCalculator,
  shoeSizeConverter,
  readabilityAnalyzer,
  tipToHourlyWage,
  pomodoroTimer,
  // Dev quick-wins (gap analysis vs it-tools/omni-tools, 260829)
  wcagContrastChecker,
  ipSubnetCalculator,
  crontabGenerator,
  jsonDiff,
  chmodCalculator,
  bcryptGenerator,
  totpGenerator,
  httpStatusCodes,
  // CSS generators (260903)
  cssGradientGenerator,
  boxShadowGenerator,
  clipPathGenerator,
  // Office files, read in the tab (260903)
  xlsxToCsv,
];

export function getToolMeta(cluster: string, slug: string): ToolMeta | undefined {
  return toolMetas.find((m) => m.cluster === cluster && m.slug === slug);
}

export function getToolMetasByCluster(cluster: string): ToolMeta[] {
  return toolMetas.filter((m) => m.cluster === cluster);
}

/**
 * Slim client-only variant. Drops `nextStepSuggestions` (localized reasons,
 * heaviest field per tool) and `availableLocales` (rendering-time only).
 * Use this in client components (catalog, cmdk, dashboard) to avoid shipping
 * heavy workflow-chain metadata in every page bundle.
 *
 * workflow-chain.tsx imports full `toolMetas` since it needs nextStepSuggestions.
 */
export type ToolMetaClient = Pick<
  ToolMeta,
  | 'slug'
  | 'cluster'
  | 'title'
  | 'description'
  | 'keywords'
  | 'priority'
  | 'published'
  | 'isPremium'
  | 'availableLocales'
>;

export const toolMetasClient: ToolMetaClient[] = toolMetas.map((m) => ({
  slug: m.slug,
  cluster: m.cluster,
  title: m.title,
  description: m.description,
  keywords: m.keywords,
  priority: m.priority,
  published: m.published,
  isPremium: m.isPremium,
  availableLocales: m.availableLocales,
}));
