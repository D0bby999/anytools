import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'chmod-calculator',
  cluster: 'converters',
  title: {
    en: 'Chmod Calculator',
    vi: 'Tính quyền Chmod',
    es: 'Calculadora de Chmod',
    pt: 'Calculadora de Chmod',
  },
  description: {
    en: 'Convert Unix file permissions between checkboxes, octal (755) and symbolic (rwxr-xr-x) — setuid/setgid/sticky included, chmod command ready to copy. 100% local.',
    vi: 'Chuyển quyền file Unix giữa checkbox, octal (755) và ký hiệu (rwxr-xr-x) — gồm setuid/setgid/sticky, lệnh chmod sẵn để copy. 100% offline.',
    es: 'Convierte permisos Unix entre casillas, octal (755) y simbólico (rwxr-xr-x) — con setuid/setgid/sticky y comando chmod listo para copiar.',
    pt: 'Converta permissões Unix entre caixas, octal (755) e simbólico (rwxr-xr-x) — com setuid/setgid/sticky e comando chmod pronto para copiar.',
  },
  keywords: [
    'chmod calculator',
    'chmod 755',
    'file permissions',
    'unix permissions',
    'octal permissions',
    'rwx calculator',
    'tính chmod',
    'permisos chmod',
    'permissões chmod',
  ],
  priority: 'P3',
  effort: 'S',
};
