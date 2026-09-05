import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'OCR a Scanned PDF',
  dropLabel: 'Scanned PDF to read',
  failed: 'This PDF could not be read.',
  stage_starting: 'Starting the recogniser',
  stage_loadingLang: 'Loading the language',
  stage_reading: 'Reading',
  stage_working: 'Working',
  language: 'Language of the text',
  lang_eng: 'English',
  lang_vie: 'Vietnamese',
  lang_spa: 'Spanish',
  lang_por: 'Portuguese',
  // {code} is replaced with the <code>1-3, 7</code> example.
  pagesLabel: 'Pages — e.g. {code}. Blank reads them all.',
  searchable: 'Also build a searchable PDF',
  searchableNote:
    'The same scan, unchanged to look at, with the recognised words written over it invisibly so Ctrl+F and text selection work.',
  reading: 'Reading…',
  recognize: 'Recognize text',
  stopping: 'Stopping…',
  stoppingNote:
    'Stopping. The run is abandoned, so no text comes out of it — use the page range to read part of a document instead.',
  progressLine: '{stage} — page {page} ({done} of {total} done, {pct}%)',
  readSummaryOne: '1 page read, average confidence {conf}%.',
  readSummaryMany: '{n} pages read, average confidence {conf}%.',
  skippedOne:
    '1 word is missing from the searchable layer: the embedded font has no glyph for a character in it, so Ctrl+F will not find it. The .txt below is unaffected.',
  skippedMany:
    '{n} words are missing from the searchable layer: the embedded font has no glyph for some of their characters, so Ctrl+F will not find them. The .txt below is unaffected.',
  recognisedText: 'Recognised text',
  downloadTxt: 'Download .txt',
  downloadSearchable: 'Download searchable PDF',
  pageLine: 'Page {n} — {words} words, {conf}% confidence',
  error_searchableFailed: 'The text below is complete, but the searchable PDF could not be built.',
  error_layerFontFetch:
    'The Unicode font the searchable layer needs could not be loaded. Check your connection and try again.',
  error_layerFontHttp:
    'The Unicode font the searchable layer needs could not be loaded (HTTP {status}).',
  error_layerPdfPasswordProtected:
    '"{name}" is password-protected, so a text layer cannot be written into it. Remove the password, or turn the searchable-PDF option off to get the text on its own.',
  error_layerPdfUnreadable:
    '"{name}" could not be re-opened to write the text layer into. Turn the searchable-PDF option off to get the text on its own.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'OCR PDF quét',
    dropLabel: 'PDF quét cần đọc',
    failed: 'Không đọc được PDF này.',
    stage_starting: 'Đang khởi động bộ nhận dạng',
    stage_loadingLang: 'Đang tải ngôn ngữ',
    stage_reading: 'Đang đọc',
    stage_working: 'Đang xử lý',
    language: 'Ngôn ngữ của văn bản',
    lang_eng: 'Tiếng Anh',
    lang_vie: 'Tiếng Việt',
    lang_spa: 'Tiếng Tây Ban Nha',
    lang_por: 'Tiếng Bồ Đào Nha',
    pagesLabel: 'Trang — vd. {code}. Để trống sẽ đọc tất cả.',
    searchable: 'Tạo thêm PDF có thể tìm kiếm',
    searchableNote:
      'Bản quét y nguyên khi nhìn, nhưng có lớp chữ đã nhận dạng ghi đè ẩn lên trên để Ctrl+F và bôi chọn văn bản hoạt động.',
    reading: 'Đang đọc…',
    recognize: 'Nhận dạng văn bản',
    stopping: 'Đang dừng…',
    stoppingNote:
      'Đang dừng. Lượt chạy bị hủy nên không có văn bản nào được xuất ra — hãy dùng phạm vi trang để đọc một phần tài liệu.',
    progressLine: '{stage} — trang {page} (xong {done}/{total}, {pct}%)',
    readSummaryOne: 'Đã đọc 1 trang, độ tin cậy trung bình {conf}%.',
    readSummaryMany: 'Đã đọc {n} trang, độ tin cậy trung bình {conf}%.',
    skippedOne:
      '1 từ bị thiếu trong lớp tìm kiếm: phông nhúng không có glyph cho một ký tự trong từ đó nên Ctrl+F sẽ không tìm thấy. Tệp .txt bên dưới không bị ảnh hưởng.',
    skippedMany:
      '{n} từ bị thiếu trong lớp tìm kiếm: phông nhúng không có glyph cho một số ký tự trong đó nên Ctrl+F sẽ không tìm thấy. Tệp .txt bên dưới không bị ảnh hưởng.',
    recognisedText: 'Văn bản đã nhận dạng',
    downloadTxt: 'Tải .txt',
    downloadSearchable: 'Tải PDF có thể tìm kiếm',
    pageLine: 'Trang {n} — {words} từ, độ tin cậy {conf}%',
    error_searchableFailed: 'Văn bản bên dưới đã đầy đủ, nhưng không tạo được PDF có thể tìm kiếm.',
    error_layerFontFetch:
      'Không tải được phông Unicode mà lớp tìm kiếm cần. Hãy kiểm tra kết nối rồi thử lại.',
    error_layerFontHttp: 'Không tải được phông Unicode mà lớp tìm kiếm cần (HTTP {status}).',
    error_layerPdfPasswordProtected:
      '"{name}" được bảo vệ bằng mật khẩu nên không ghi được lớp chữ vào. Hãy gỡ mật khẩu, hoặc tắt tùy chọn PDF có thể tìm kiếm để chỉ lấy văn bản.',
    error_layerPdfUnreadable:
      'Không mở lại được "{name}" để ghi lớp chữ vào. Hãy tắt tùy chọn PDF có thể tìm kiếm để chỉ lấy văn bản.',
  },
  es: {
    title: 'OCR de un PDF escaneado',
    dropLabel: 'PDF escaneado a leer',
    failed: 'No se pudo leer este PDF.',
    stage_starting: 'Iniciando el reconocedor',
    stage_loadingLang: 'Cargando el idioma',
    stage_reading: 'Leyendo',
    stage_working: 'Trabajando',
    language: 'Idioma del texto',
    lang_eng: 'Inglés',
    lang_vie: 'Vietnamita',
    lang_spa: 'Español',
    lang_por: 'Portugués',
    pagesLabel: 'Páginas — p. ej. {code}. En blanco las lee todas.',
    searchable: 'Generar también un PDF con búsqueda',
    searchableNote:
      'El mismo escaneo, idéntico a la vista, con las palabras reconocidas escritas encima de forma invisible para que Ctrl+F y la selección de texto funcionen.',
    reading: 'Leyendo…',
    recognize: 'Reconocer texto',
    stopping: 'Deteniendo…',
    stoppingNote:
      'Deteniendo. La ejecución se abandona, así que no sale texto de ella — usa el rango de páginas para leer parte de un documento.',
    progressLine: '{stage} — página {page} ({done} de {total} listas, {pct}%)',
    readSummaryOne: '1 página leída, confianza media {conf}%.',
    readSummaryMany: '{n} páginas leídas, confianza media {conf}%.',
    skippedOne:
      'Falta 1 palabra en la capa de búsqueda: la fuente incrustada no tiene glifo para un carácter de ella, así que Ctrl+F no la encontrará. El .txt de abajo no se ve afectado.',
    skippedMany:
      'Faltan {n} palabras en la capa de búsqueda: la fuente incrustada no tiene glifo para algunos de sus caracteres, así que Ctrl+F no las encontrará. El .txt de abajo no se ve afectado.',
    recognisedText: 'Texto reconocido',
    downloadTxt: 'Descargar .txt',
    downloadSearchable: 'Descargar PDF con búsqueda',
    pageLine: 'Página {n} — {words} palabras, {conf}% de confianza',
    error_searchableFailed:
      'El texto de abajo está completo, pero no se pudo generar el PDF con búsqueda.',
    error_layerFontFetch:
      'No se pudo cargar la fuente Unicode que la capa de búsqueda necesita. Comprueba tu conexión e inténtalo de nuevo.',
    error_layerFontHttp:
      'No se pudo cargar la fuente Unicode que la capa de búsqueda necesita (HTTP {status}).',
    error_layerPdfPasswordProtected:
      '"{name}" está protegido con contraseña, así que no se puede escribir una capa de texto en él. Quita la contraseña, o desactiva la opción de PDF con búsqueda para obtener solo el texto.',
    error_layerPdfUnreadable:
      'No se pudo volver a abrir "{name}" para escribir la capa de texto. Desactiva la opción de PDF con búsqueda para obtener solo el texto.',
  },
  pt: {
    title: 'OCR de PDF escaneado',
    dropLabel: 'PDF escaneado a ler',
    failed: 'Não foi possível ler este PDF.',
    stage_starting: 'Iniciando o reconhecedor',
    stage_loadingLang: 'Carregando o idioma',
    stage_reading: 'Lendo',
    stage_working: 'Trabalhando',
    language: 'Idioma do texto',
    lang_eng: 'Inglês',
    lang_vie: 'Vietnamita',
    lang_spa: 'Espanhol',
    lang_por: 'Português',
    pagesLabel: 'Páginas — ex. {code}. Em branco lê todas.',
    searchable: 'Gerar também um PDF pesquisável',
    searchableNote:
      'O mesmo escaneamento, idêntico à vista, com as palavras reconhecidas escritas por cima de forma invisível para que Ctrl+F e a seleção de texto funcionem.',
    reading: 'Lendo…',
    recognize: 'Reconhecer texto',
    stopping: 'Parando…',
    stoppingNote:
      'Parando. A execução é abandonada, então nenhum texto sai dela — use o intervalo de páginas para ler parte de um documento.',
    progressLine: '{stage} — página {page} ({done} de {total} concluídas, {pct}%)',
    readSummaryOne: '1 página lida, confiança média {conf}%.',
    readSummaryMany: '{n} páginas lidas, confiança média {conf}%.',
    skippedOne:
      'Falta 1 palavra na camada pesquisável: a fonte incorporada não tem glifo para um caractere dela, então o Ctrl+F não a encontrará. O .txt abaixo não é afetado.',
    skippedMany:
      'Faltam {n} palavras na camada pesquisável: a fonte incorporada não tem glifo para alguns de seus caracteres, então o Ctrl+F não as encontrará. O .txt abaixo não é afetado.',
    recognisedText: 'Texto reconhecido',
    downloadTxt: 'Baixar .txt',
    downloadSearchable: 'Baixar PDF pesquisável',
    pageLine: 'Página {n} — {words} palavras, {conf}% de confiança',
    error_searchableFailed:
      'O texto abaixo está completo, mas não foi possível gerar o PDF pesquisável.',
    error_layerFontFetch:
      'Não foi possível carregar a fonte Unicode de que a camada pesquisável precisa. Verifique sua conexão e tente de novo.',
    error_layerFontHttp:
      'Não foi possível carregar a fonte Unicode de que a camada pesquisável precisa (HTTP {status}).',
    error_layerPdfPasswordProtected:
      '"{name}" está protegido por senha, então não é possível gravar uma camada de texto nele. Remova a senha, ou desative a opção de PDF pesquisável para obter só o texto.',
    error_layerPdfUnreadable:
      'Não foi possível reabrir "{name}" para gravar a camada de texto. Desative a opção de PDF pesquisável para obter só o texto.',
  },
};
