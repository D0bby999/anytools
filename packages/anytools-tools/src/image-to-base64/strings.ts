import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Image to Base64',
  tabEncode: 'Image → Base64',
  tabDecode: 'Base64 → Image',
  dropLabel: 'Image to encode',
  sizeWarning:
    'The encoded text is {encoded}, {percent}% larger than the {original} file — base64 always adds about a third. Embedding it inline will make the HTML/CSS/Markdown page noticeably heavier; a linked file is usually better past this size.',
  dataUri: 'Data URI',
  htmlTag: 'HTML <img> tag',
  cssBackground: 'CSS background-image',
  cssUrl: 'CSS url()',
  markdown: 'Markdown',
  pasteLabel: 'Paste a data URI',
  pastePlaceholder: 'data:image/png;base64,iVBORw0KGgo...',
  decodePreviewAlt: 'Decoded image',
  downloadDecoded: 'Download image',
  failed: 'Encoding failed',
  decodeFailed: 'Could not read that data URI',
  error_readFailed: '"{name}" could not be read.',
  error_notAnImage: '"{name}" is not an image (its type is "{mime}").',
  error_badDataUri: 'That is not a data URI. It should start with "data:image/...;base64,".',
  error_notBase64DataUri:
    'This data URI is not base64-encoded — paste one that ends in ";base64,<data>".',
  error_dataUriNotImage: 'This data URI\'s type is "{mime}", not an image.',
  error_badBase64:
    'The base64 payload could not be decoded — check nothing was cut off when it was copied.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Ảnh sang Base64',
    tabEncode: 'Ảnh → Base64',
    tabDecode: 'Base64 → Ảnh',
    dropLabel: 'Ảnh cần encode',
    sizeWarning:
      'Đoạn mã đã encode dài {encoded}, lớn hơn {percent}% so với file gốc {original} — base64 luôn phình thêm khoảng một phần ba. Nhúng thẳng vào trang sẽ làm HTML/CSS/Markdown nặng thêm rõ rệt; với kích thước này, dùng file liên kết thường tốt hơn.',
    dataUri: 'Data URI',
    htmlTag: 'Thẻ HTML <img>',
    cssBackground: 'CSS background-image',
    cssUrl: 'CSS url()',
    markdown: 'Markdown',
    pasteLabel: 'Dán một data URI',
    pastePlaceholder: 'data:image/png;base64,iVBORw0KGgo...',
    decodePreviewAlt: 'Ảnh đã giải mã',
    downloadDecoded: 'Tải ảnh xuống',
    failed: 'Encode thất bại',
    decodeFailed: 'Không đọc được data URI này',
    error_readFailed: 'Không đọc được "{name}".',
    error_notAnImage: '"{name}" không phải ảnh (kiểu tệp là "{mime}").',
    error_badDataUri: 'Đây không phải data URI. Phải bắt đầu bằng "data:image/...;base64,".',
    error_notBase64DataUri:
      'Data URI này không được mã hoá base64 — dán một chuỗi kết thúc bằng ";base64,<dữ liệu>".',
    error_dataUriNotImage: 'Kiểu của data URI này là "{mime}", không phải ảnh.',
    error_badBase64:
      'Không giải mã được phần base64 — kiểm tra xem có bị cắt bớt khi sao chép không.',
  },
  es: {
    title: 'Imagen a Base64',
    tabEncode: 'Imagen → Base64',
    tabDecode: 'Base64 → Imagen',
    dropLabel: 'Imagen a codificar',
    sizeWarning:
      'El texto codificado mide {encoded}, un {percent}% más que el archivo original de {original} — base64 siempre añade cerca de un tercio. Incrustarlo hará la página HTML/CSS/Markdown notablemente más pesada; a partir de este tamaño suele ser mejor un archivo enlazado.',
    dataUri: 'Data URI',
    htmlTag: 'Etiqueta HTML <img>',
    cssBackground: 'CSS background-image',
    cssUrl: 'CSS url()',
    markdown: 'Markdown',
    pasteLabel: 'Pega un data URI',
    pastePlaceholder: 'data:image/png;base64,iVBORw0KGgo...',
    decodePreviewAlt: 'Imagen decodificada',
    downloadDecoded: 'Descargar imagen',
    failed: 'Error al codificar',
    decodeFailed: 'No se pudo leer ese data URI',
    error_readFailed: 'No se pudo leer "{name}".',
    error_notAnImage: '"{name}" no es una imagen (su tipo es "{mime}").',
    error_badDataUri: 'Eso no es un data URI. Debe empezar con "data:image/...;base64,".',
    error_notBase64DataUri:
      'Este data URI no está codificado en base64 — pega uno que termine en ";base64,<datos>".',
    error_dataUriNotImage: 'El tipo de este data URI es "{mime}", no una imagen.',
    error_badBase64:
      'No se pudo decodificar el base64 — comprueba que no se haya cortado al copiarlo.',
  },
  pt: {
    title: 'Imagem para Base64',
    tabEncode: 'Imagem → Base64',
    tabDecode: 'Base64 → Imagem',
    dropLabel: 'Imagem para codificar',
    sizeWarning:
      'O texto codificado tem {encoded}, {percent}% maior que o arquivo original de {original} — o base64 sempre acrescenta cerca de um terço. Incorporá-lo deixará a página HTML/CSS/Markdown visivelmente mais pesada; a partir desse tamanho, um arquivo ligado costuma ser melhor.',
    dataUri: 'Data URI',
    htmlTag: 'Tag HTML <img>',
    cssBackground: 'CSS background-image',
    cssUrl: 'CSS url()',
    markdown: 'Markdown',
    pasteLabel: 'Cole um data URI',
    pastePlaceholder: 'data:image/png;base64,iVBORw0KGgo...',
    decodePreviewAlt: 'Imagem decodificada',
    downloadDecoded: 'Baixar imagem',
    failed: 'Falha ao codificar',
    decodeFailed: 'Não foi possível ler esse data URI',
    error_readFailed: 'Não foi possível ler "{name}".',
    error_notAnImage: '"{name}" não é uma imagem (o tipo é "{mime}").',
    error_badDataUri: 'Isso não é um data URI. Deve começar com "data:image/...;base64,".',
    error_notBase64DataUri:
      'Este data URI não está em base64 — cole um que termine em ";base64,<dados>".',
    error_dataUriNotImage: 'O tipo deste data URI é "{mime}", não uma imagem.',
    error_badBase64:
      'Não foi possível decodificar o base64 — verifique se nada foi cortado ao copiar.',
  },
};
