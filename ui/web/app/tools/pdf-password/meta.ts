import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'pdf-password',
  cluster: 'pdf',
  // Widget strings are localized (strings.ts). Where no vi/es/pt FAQ body exists yet the
  // page serves noindex and stays out of the sitemap (has-localized-tool-body.ts).
  title: {
    en: 'PDF Password — Add or Remove',
    vi: 'Mật Khẩu PDF — Đặt Hoặc Gỡ',
    es: 'Contraseña de PDF — Añadir o Quitar',
    pt: 'Senha de PDF — Adicionar ou Remover',
  },
  description: {
    en: 'Lock a PDF with a password, or remove one you already know. Runs entirely in your browser — nothing is uploaded.',
    vi: 'Đặt mật khẩu cho PDF, hoặc gỡ mật khẩu bạn đã biết. Chạy hoàn toàn trong trình duyệt, không tải lên.',
    es: 'Protege un PDF con contraseña, o quita una que ya conoces. Se ejecuta en tu navegador; no se sube nada.',
    pt: 'Proteja um PDF com senha, ou remova uma que você já conhece. Roda no seu navegador; nada é enviado.',
  },
  keywords: [
    'pdf password',
    'add password to pdf',
    'remove password from pdf',
    'encrypt pdf',
    'unlock pdf online',
    'protect pdf with password',
    'pdf password remover',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'watermark-pdf',
      reason: {
        en: 'Mark a document as confidential before locking it',
        vi: 'Đóng dấu "mật" trước khi khóa tài liệu',
        es: 'Marcar el documento como confidencial antes de protegerlo',
        pt: 'Marcar o documento como confidencial antes de protegê-lo',
      },
    },
    {
      tool: 'merge-pdf',
      reason: {
        en: 'Combine files first, then lock the result with one password',
        vi: 'Gộp các tệp trước, rồi khóa kết quả bằng một mật khẩu',
        es: 'Combinar los archivos primero y proteger el resultado con una sola contraseña',
        pt: 'Combinar os arquivos primeiro e proteger o resultado com uma única senha',
      },
    },
  ],
};
