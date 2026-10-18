import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'mock-data-generator',
  cluster: 'generators',
  title: {
    en: 'Mock Data Generator',
    vi: 'Tạo Dữ Liệu Mock',
    es: 'Generador de datos de prueba',
    pt: 'Gerador de dados de teste',
  },
  description: {
    en: 'Generate realistic mock data (users, emails, addresses, dates) as JSON, CSV, or SQL. 7 locales.',
    vi: 'Tạo dữ liệu mock thực tế (user, email, địa chỉ, ngày) ở dạng JSON, CSV, SQL. 7 locale.',
    es: 'Genera datos ficticios realistas (usuarios, emails, direcciones, fechas) en JSON, CSV o SQL. 7 idiomas.',
    pt: 'Gera dados fictícios realistas (usuários, e-mails, endereços, datas) em JSON, CSV ou SQL. 7 idiomas.',
  },
  keywords: ['mock data', 'fake data', 'test data', 'fixture generator', 'faker', 'seed data'],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'json-formatter',
      reason: { en: 'Format the generated JSON', vi: 'Format JSON đã tạo' },
    },
    {
      tool: 'csv-json',
      reason: { en: 'Convert between CSV and JSON', vi: 'Chuyển giữa CSV và JSON' },
    },
  ],
};
