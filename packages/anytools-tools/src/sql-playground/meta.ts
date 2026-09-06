import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'sql-playground',
  cluster: 'formatters',
  title: {
    en: 'SQL Playground',
    vi: 'Playground SQL',
    es: 'Playground de SQL',
    pt: 'Playground de SQL',
  },
  description: {
    en: 'A real SQLite database in the tab. Type CREATE/INSERT, upload a .sqlite/.db file, or import a CSV as a table, then query it. Browser-only.',
    vi: 'Database SQLite thật ngay trong tab. Gõ CREATE/INSERT, upload file .sqlite/.db, hoặc import CSV thành bảng, rồi query. Chỉ trong browser.',
    es: 'Una base de datos SQLite real en la pestaña. Escribe CREATE/INSERT, sube un archivo .sqlite/.db o importa un CSV como tabla, y luego consúltala. Solo en el navegador.',
    pt: 'Um banco SQLite real direto na aba. Digite CREATE/INSERT, envie um arquivo .sqlite/.db ou importe um CSV como tabela, e consulte. Só no navegador.',
  },
  keywords: [
    'sql playground',
    'sqlite online',
    'sql.js',
    'run sql query',
    'csv to sql',
    'sql trực tuyến',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'sql-formatter',
      reason: {
        en: 'Format the query before running it here',
        vi: 'Định dạng query trước khi chạy ở đây',
      },
    },
    {
      tool: 'csv-json',
      reason: {
        en: 'Convert a query result to JSON without downloading it first',
        vi: 'Chuyển kết quả query sang JSON mà không cần tải xuống trước',
      },
    },
    {
      tool: 'json-formatter',
      reason: {
        en: 'Pretty-print a query result exported as JSON',
        vi: 'Format lại kết quả query đã export sang JSON',
      },
    },
  ],
};
