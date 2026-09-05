/**
 * Localized templates for the errors the SHARED modules throw — canvas-image, pdfjs-loader,
 * page-range, pdf-unicode-font, pdf-page-stamp, tesseract-loader, onnx-loader.
 *
 * Those modules know nothing about locales (see tool-error.ts), and a dozen tools rethrow their
 * errors untouched. Rather than every tool copying the same twenty translations, each widget
 * merges this table under its own: `toolErrorText(e, { ...sharedErrors, ...s }, fallback)`. A
 * tool that needs a different wording for one code overrides it in its own strings.ts — the
 * spread puts the tool's key last, so it wins.
 *
 * Every English template must reproduce the thrown message exactly: at locale `en` the widget
 * still goes through the template, so a drift here would change what English users see.
 */
import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  // canvas-image
  error_imageUnreadable:
    '"{name}" could not be read as an image. Check that the file is a PNG, JPEG, WebP, GIF or AVIF.',
  error_imageTooLarge:
    'This image is {width}×{height} ({mp} megapixels), above what this browser can decode onto a canvas. Resize it in an image editor first.',
  error_noCanvasContext: 'Your browser did not provide a 2D canvas context.',
  error_encodeFailed: 'Your browser could not encode {format}.',
  // pdf-unicode-font / pdf-page-stamp. {subject} is English prose ("The watermark text"); the
  // two tools that draw text override these keys with the subject written into the sentence.
  error_unicodeFontFetch:
    'The Unicode font this text needs could not be loaded. Check your connection and try again.',
  error_unicodeFontHttp: 'The Unicode font this text needs could not be loaded (HTTP {status}).',
  error_unicodeFontNeeded: '{subject} needs the Unicode font, which could not be loaded. {detail}',
  error_fontCoverage:
    '{subject} uses characters no available font can draw: {missing}. Latin characters (including Vietnamese), Greek and Cyrillic are covered; Chinese, Japanese, Korean, Arabic and emoji are not.',
  error_textNotDrawable:
    '{subject} uses characters the font cannot draw. Latin characters (including Vietnamese), Greek and Cyrillic are covered; Chinese, Japanese, Korean, Arabic and emoji are not.',
  // pdfjs-loader — and the pdf-lib tools, which word the same two failures identically.
  error_pdfPasswordProtected: '"{name}" is password-protected. Remove the password and try again.',
  error_pdfWorkerFailed:
    'The PDF renderer failed to start (worker could not load). This is a bug on our side, not a problem with your file.',
  error_pdfUnreadable: '"{name}" could not be read as a PDF.',
  // page-range
  error_rangeEmpty: 'Enter at least one page or range, e.g. 1-3, 7.',
  error_noPages: 'The document has no pages.',
  error_rangeBadPart: '"{part}" is not a page or a range. Use formats like 4 or 2-6.',
  error_pageStartsAtOne: 'Pages start at 1.',
  error_pageOutOfRangeOne: 'Page {page} does not exist — the document has {count} page.',
  error_pageOutOfRange: 'Page {page} does not exist — the document has {count} pages.',
  // tesseract-loader. {langLabel} is the English language name; translations leave it out.
  error_ocrStartFailed:
    'The {langLabel} recogniser could not start. Reload the page and try again.',
  // onnx-loader
  error_engineDownloadFailed:
    'The background-removal engine could not be downloaded. This is a bug on our side, not a problem with your image.',
  error_modelDownloadFailed:
    'The background-removal model could not be downloaded. This is a bug on our side, not a problem with your image.',
  error_engineCorrupted:
    'The background-removal engine arrived corrupted (checksum {actual}…, expected {expected}…). This is a bug on our side, not a problem with your image.',
  error_modelCorrupted:
    'The background-removal model arrived corrupted (checksum {actual}…, expected {expected}…). This is a bug on our side, not a problem with your image.',
  error_engineStartFailed:
    'The background-removal engine failed to start ({detail}). This is a bug on our side, not a problem with your image.',
};

export const SHARED_ERROR_STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    error_imageUnreadable:
      'Không đọc được "{name}" dưới dạng ảnh. Hãy kiểm tra tệp có phải PNG, JPEG, WebP, GIF hoặc AVIF không.',
    error_imageTooLarge:
      'Ảnh này có kích thước {width}×{height} ({mp} megapixel), vượt quá mức trình duyệt có thể giải mã lên canvas. Hãy thu nhỏ ảnh bằng trình chỉnh sửa ảnh trước.',
    error_noCanvasContext: 'Trình duyệt của bạn không cung cấp được ngữ cảnh canvas 2D.',
    error_encodeFailed: 'Trình duyệt của bạn không mã hóa được {format}.',
    error_unicodeFontFetch:
      'Không tải được phông Unicode mà văn bản này cần. Hãy kiểm tra kết nối rồi thử lại.',
    error_unicodeFontHttp: 'Không tải được phông Unicode mà văn bản này cần (HTTP {status}).',
    error_unicodeFontNeeded: '{subject} cần phông Unicode nhưng không tải được. {detail}',
    error_fontCoverage:
      '{subject} chứa ký tự mà không phông nào sẵn có vẽ được: {missing}. Ký tự Latin (kể cả tiếng Việt), Hy Lạp và Kirin được hỗ trợ; tiếng Trung, Nhật, Hàn, Ả Rập và emoji thì không.',
    error_textNotDrawable:
      '{subject} chứa ký tự mà phông không vẽ được. Ký tự Latin (kể cả tiếng Việt), Hy Lạp và Kirin được hỗ trợ; tiếng Trung, Nhật, Hàn, Ả Rập và emoji thì không.',
    error_pdfPasswordProtected: '"{name}" được bảo vệ bằng mật khẩu. Hãy gỡ mật khẩu rồi thử lại.',
    error_pdfWorkerFailed:
      'Bộ kết xuất PDF không khởi động được (không tải được worker). Đây là lỗi phía chúng tôi, không phải do tệp của bạn.',
    error_pdfUnreadable: 'Không đọc được "{name}" dưới dạng PDF.',
    error_rangeEmpty: 'Nhập ít nhất một trang hoặc một khoảng trang, vd. 1-3, 7.',
    error_noPages: 'Tài liệu không có trang nào.',
    error_rangeBadPart: '"{part}" không phải số trang hay khoảng trang. Dùng dạng như 4 hoặc 2-6.',
    error_pageStartsAtOne: 'Số trang bắt đầu từ 1.',
    error_pageOutOfRangeOne: 'Trang {page} không tồn tại — tài liệu chỉ có {count} trang.',
    error_pageOutOfRange: 'Trang {page} không tồn tại — tài liệu chỉ có {count} trang.',
    error_ocrStartFailed: 'Bộ nhận dạng không khởi động được. Hãy tải lại trang rồi thử lại.',
    error_engineDownloadFailed:
      'Không tải được engine xóa nền. Đây là lỗi phía chúng tôi, không phải do ảnh của bạn.',
    error_modelDownloadFailed:
      'Không tải được mô hình xóa nền. Đây là lỗi phía chúng tôi, không phải do ảnh của bạn.',
    error_engineCorrupted:
      'Engine xóa nền tải về bị hỏng (checksum {actual}…, mong đợi {expected}…). Đây là lỗi phía chúng tôi, không phải do ảnh của bạn.',
    error_modelCorrupted:
      'Mô hình xóa nền tải về bị hỏng (checksum {actual}…, mong đợi {expected}…). Đây là lỗi phía chúng tôi, không phải do ảnh của bạn.',
    error_engineStartFailed:
      'Engine xóa nền không khởi động được ({detail}). Đây là lỗi phía chúng tôi, không phải do ảnh của bạn.',
  },
  es: {
    error_imageUnreadable:
      'No se pudo leer "{name}" como imagen. Comprueba que el archivo sea PNG, JPEG, WebP, GIF o AVIF.',
    error_imageTooLarge:
      'Esta imagen mide {width}×{height} ({mp} megapíxeles), más de lo que este navegador puede decodificar en un canvas. Redúcela primero en un editor de imágenes.',
    error_noCanvasContext: 'Tu navegador no proporcionó un contexto de canvas 2D.',
    error_encodeFailed: 'Tu navegador no pudo codificar {format}.',
    error_unicodeFontFetch:
      'No se pudo cargar la fuente Unicode que este texto necesita. Comprueba tu conexión e inténtalo de nuevo.',
    error_unicodeFontHttp:
      'No se pudo cargar la fuente Unicode que este texto necesita (HTTP {status}).',
    error_unicodeFontNeeded:
      '{subject} necesita la fuente Unicode, que no se pudo cargar. {detail}',
    error_fontCoverage:
      '{subject} contiene caracteres que ninguna fuente disponible puede dibujar: {missing}. Los caracteres latinos (incluido el vietnamita), el griego y el cirílico están cubiertos; el chino, japonés, coreano, árabe y los emoji no.',
    error_textNotDrawable:
      '{subject} contiene caracteres que la fuente no puede dibujar. Los caracteres latinos (incluido el vietnamita), el griego y el cirílico están cubiertos; el chino, japonés, coreano, árabe y los emoji no.',
    error_pdfPasswordProtected:
      '"{name}" está protegido con contraseña. Quita la contraseña e inténtalo de nuevo.',
    error_pdfWorkerFailed:
      'El renderizador de PDF no pudo iniciarse (no se cargó el worker). Es un fallo nuestro, no un problema de tu archivo.',
    error_pdfUnreadable: 'No se pudo leer "{name}" como PDF.',
    error_rangeEmpty: 'Introduce al menos una página o un rango, p. ej. 1-3, 7.',
    error_noPages: 'El documento no tiene páginas.',
    error_rangeBadPart: '"{part}" no es una página ni un rango. Usa formatos como 4 o 2-6.',
    error_pageStartsAtOne: 'Las páginas empiezan en 1.',
    error_pageOutOfRangeOne: 'La página {page} no existe — el documento tiene {count} página.',
    error_pageOutOfRange: 'La página {page} no existe — el documento tiene {count} páginas.',
    error_ocrStartFailed:
      'El reconocedor no pudo iniciarse. Recarga la página e inténtalo de nuevo.',
    error_engineDownloadFailed:
      'No se pudo descargar el motor de eliminación de fondo. Es un fallo nuestro, no un problema de tu imagen.',
    error_modelDownloadFailed:
      'No se pudo descargar el modelo de eliminación de fondo. Es un fallo nuestro, no un problema de tu imagen.',
    error_engineCorrupted:
      'El motor de eliminación de fondo llegó corrupto (checksum {actual}…, se esperaba {expected}…). Es un fallo nuestro, no un problema de tu imagen.',
    error_modelCorrupted:
      'El modelo de eliminación de fondo llegó corrupto (checksum {actual}…, se esperaba {expected}…). Es un fallo nuestro, no un problema de tu imagen.',
    error_engineStartFailed:
      'El motor de eliminación de fondo no pudo iniciarse ({detail}). Es un fallo nuestro, no un problema de tu imagen.',
  },
  pt: {
    error_imageUnreadable:
      'Não foi possível ler "{name}" como imagem. Verifique se o arquivo é PNG, JPEG, WebP, GIF ou AVIF.',
    error_imageTooLarge:
      'Esta imagem tem {width}×{height} ({mp} megapixels), mais do que este navegador consegue decodificar em um canvas. Reduza-a primeiro em um editor de imagens.',
    error_noCanvasContext: 'Seu navegador não forneceu um contexto de canvas 2D.',
    error_encodeFailed: 'Seu navegador não conseguiu codificar {format}.',
    error_unicodeFontFetch:
      'Não foi possível carregar a fonte Unicode de que este texto precisa. Verifique sua conexão e tente de novo.',
    error_unicodeFontHttp:
      'Não foi possível carregar a fonte Unicode de que este texto precisa (HTTP {status}).',
    error_unicodeFontNeeded:
      '{subject} precisa da fonte Unicode, que não pôde ser carregada. {detail}',
    error_fontCoverage:
      '{subject} contém caracteres que nenhuma fonte disponível consegue desenhar: {missing}. Caracteres latinos (incluindo vietnamita), grego e cirílico são cobertos; chinês, japonês, coreano, árabe e emoji não.',
    error_textNotDrawable:
      '{subject} contém caracteres que a fonte não consegue desenhar. Caracteres latinos (incluindo vietnamita), grego e cirílico são cobertos; chinês, japonês, coreano, árabe e emoji não.',
    error_pdfPasswordProtected:
      '"{name}" está protegido por senha. Remova a senha e tente de novo.',
    error_pdfWorkerFailed:
      'O renderizador de PDF não conseguiu iniciar (o worker não carregou). Isso é um erro nosso, não um problema com o seu arquivo.',
    error_pdfUnreadable: 'Não foi possível ler "{name}" como PDF.',
    error_rangeEmpty: 'Informe pelo menos uma página ou um intervalo, ex. 1-3, 7.',
    error_noPages: 'O documento não tem páginas.',
    error_rangeBadPart: '"{part}" não é uma página nem um intervalo. Use formatos como 4 ou 2-6.',
    error_pageStartsAtOne: 'As páginas começam em 1.',
    error_pageOutOfRangeOne: 'A página {page} não existe — o documento tem {count} página.',
    error_pageOutOfRange: 'A página {page} não existe — o documento tem {count} páginas.',
    error_ocrStartFailed:
      'O reconhecedor não conseguiu iniciar. Recarregue a página e tente de novo.',
    error_engineDownloadFailed:
      'Não foi possível baixar o motor de remoção de fundo. Isso é um erro nosso, não um problema com a sua imagem.',
    error_modelDownloadFailed:
      'Não foi possível baixar o modelo de remoção de fundo. Isso é um erro nosso, não um problema com a sua imagem.',
    error_engineCorrupted:
      'O motor de remoção de fundo chegou corrompido (checksum {actual}…, esperado {expected}…). Isso é um erro nosso, não um problema com a sua imagem.',
    error_modelCorrupted:
      'O modelo de remoção de fundo chegou corrompido (checksum {actual}…, esperado {expected}…). Isso é um erro nosso, não um problema com a sua imagem.',
    error_engineStartFailed:
      'O motor de remoção de fundo não conseguiu iniciar ({detail}). Isso é um erro nosso, não um problema com a sua imagem.',
  },
};

/**
 * Localize an error a logic function RETURNED rather than threw — `{ error, code, params }` rows
 * such as a per-file failure in a batch. Same lookup as `toolErrorText`, for data that never was
 * an Error object: `error_<code>` in `strings`, params filled in, else the English `fallback`.
 */
export function returnedErrorText(
  strings: Record<string, string>,
  code: string | undefined,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  const template = code ? strings[`error_${code}`] : undefined;
  if (!template) return fallback;
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    params && key in params ? String(params[key]) : m,
  );
}
