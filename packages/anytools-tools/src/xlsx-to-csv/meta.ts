import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'xlsx-to-csv',
  cluster: 'converters',
  title: {
    en: 'XLSX to CSV / JSON Converter',
    vi: 'Chuyển XLSX sang CSV / JSON',
    es: 'Convertidor de XLSX a CSV / JSON',
    pt: 'Conversor de XLSX para CSV / JSON',
  },
  description: {
    en: 'Open an .xlsx workbook, pick a sheet, and export it as CSV or JSON. Dates come out as dates, formulas as their results. Runs in your browser.',
    vi: 'Mở file .xlsx, chọn sheet, xuất ra CSV hoặc JSON. Ngày ra đúng ngày, công thức ra kết quả. Chạy trong trình duyệt.',
    es: 'Abre un libro .xlsx, elige una hoja y expórtala a CSV o JSON. Las fechas salen como fechas. Todo en el navegador.',
    pt: 'Abra uma pasta .xlsx, escolha uma planilha e exporte para CSV ou JSON. Datas saem como datas. Tudo no navegador.',
  },
  keywords: [
    'xlsx to csv',
    'excel to csv',
    'xlsx to json',
    'excel to json',
    'convert spreadsheet',
    'xlsx viewer',
  ],
  priority: 'P2',
  effort: 'M',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  nextStepSuggestions: [
    {
      tool: 'csv-json',
      reason: {
        en: 'Reshape the CSV, or convert it back to JSON with a different header setup',
        vi: 'Chỉnh lại CSV hoặc đổi sang JSON với cách đặt header khác',
      },
    },
    {
      tool: 'json-formatter',
      reason: {
        en: 'Validate and reformat the JSON export',
        vi: 'Kiểm tra và format lại JSON vừa xuất',
      },
    },
    {
      tool: 'docx-to-markdown',
      reason: {
        en: 'Do the same for a Word document',
        vi: 'Làm tương tự với file Word',
      },
    },
  ],
};
