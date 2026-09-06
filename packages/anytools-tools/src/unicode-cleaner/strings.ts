import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Unicode Cleaner',
  description:
    'Paste text to find invisible characters and letters from other alphabets that only look Latin.',
  inputLabel: 'Text to check',
  placeholder: 'Paste text here…',
  noIssues: 'No invisible characters or look-alike letters found.',
  issuesSummary: '{count} issue(s) found',
  invisibleBadge: 'Invisible',
  homoglyphBadge: 'Look-alike',
  previewLabel: 'Preview — flagged characters are highlighted',
  detailsLabel: 'Details',
  position: 'Position',
  character: 'Character',
  codePointCol: 'Code point',
  nameCol: 'Name',
  looksLikeCol: 'Looks like',
  cleanButton: 'Clean text',
  heuristicNote:
    'Look-alike letters are only flagged when the rest of the pasted text is a different script — a full paragraph of real Russian or Greek is left alone.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Dọn ký tự Unicode ẩn',
    description:
      'Dán văn bản để tìm ký tự vô hình và chữ cái thuộc bảng chữ cái khác nhưng nhìn giống Latin.',
    inputLabel: 'Văn bản cần kiểm tra',
    placeholder: 'Dán văn bản vào đây…',
    noIssues: 'Không tìm thấy ký tự vô hình hay chữ cái giả dạng nào.',
    issuesSummary: 'Tìm thấy {count} vấn đề',
    invisibleBadge: 'Vô hình',
    homoglyphBadge: 'Giả dạng',
    previewLabel: 'Xem trước — ký tự bị đánh dấu được tô sáng',
    detailsLabel: 'Chi tiết',
    position: 'Vị trí',
    character: 'Ký tự',
    codePointCol: 'Mã codepoint',
    nameCol: 'Tên',
    looksLikeCol: 'Trông giống',
    cleanButton: 'Làm sạch văn bản',
    heuristicNote:
      'Chữ cái giả dạng chỉ bị đánh dấu khi phần còn lại của văn bản thuộc bảng chữ cái khác — một đoạn tiếng Nga hay Hy Lạp thật sẽ không bị báo động.',
  },
  es: {
    title: 'Limpiador de Unicode oculto',
    description:
      'Pega texto para encontrar caracteres invisibles y letras de otros alfabetos que solo parecen latinas.',
    inputLabel: 'Texto a revisar',
    placeholder: 'Pega el texto aquí…',
    noIssues: 'No se encontraron caracteres invisibles ni letras parecidas.',
    issuesSummary: 'Se encontraron {count} problema(s)',
    invisibleBadge: 'Invisible',
    homoglyphBadge: 'Parecida',
    previewLabel: 'Vista previa — los caracteres marcados están resaltados',
    detailsLabel: 'Detalles',
    position: 'Posición',
    character: 'Carácter',
    codePointCol: 'Código',
    nameCol: 'Nombre',
    looksLikeCol: 'Se parece a',
    cleanButton: 'Limpiar texto',
    heuristicNote:
      'Las letras parecidas solo se marcan cuando el resto del texto pegado es de otro alfabeto — un párrafo completo en ruso o griego real no se marca.',
  },
  pt: {
    title: 'Limpador de Unicode oculto',
    description:
      'Cole o texto para encontrar caracteres invisíveis e letras de outros alfabetos que só parecem latinas.',
    inputLabel: 'Texto para verificar',
    placeholder: 'Cole o texto aqui…',
    noIssues: 'Nenhum caractere invisível ou letra parecida foi encontrado.',
    issuesSummary: '{count} problema(s) encontrado(s)',
    invisibleBadge: 'Invisível',
    homoglyphBadge: 'Parecida',
    previewLabel: 'Pré-visualização — caracteres marcados aparecem destacados',
    detailsLabel: 'Detalhes',
    position: 'Posição',
    character: 'Caractere',
    codePointCol: 'Código',
    nameCol: 'Nome',
    looksLikeCol: 'Parece com',
    cleanButton: 'Limpar texto',
    heuristicNote:
      'Letras parecidas só são marcadas quando o resto do texto colado é de outro alfabeto — um parágrafo inteiro em russo ou grego real não é marcado.',
  },
};
