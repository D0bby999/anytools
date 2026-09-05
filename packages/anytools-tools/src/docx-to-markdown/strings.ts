import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'DOCX to Markdown',
  docLabel: 'Word document (.docx)',
  docxOnly: '.docx only.',
  // {doc} {rtf} {odt} are extensions in <code>, {saveAs} the menu path in <em>.
  formatNote:
    'The older binary {doc}, along with {rtf}, {odt} and Apple Pages files, are different formats — open one in Word, LibreOffice or Pages and use {saveAs} first.',
  saveAs: 'Save As → .docx',
  embedImages: 'Embed images as data URIs (off by default — one photo can add megabytes of base64)',
  tooLarge:
    'This document is {size} MB, over the {max} MB limit. A .docx is compressed, and the unzipped XML, the HTML and the Markdown all have to be held in the tab at once. Split the document, or save a copy with the images removed, and try again.',
  slow: "This document is over 20 MB. Conversion happens on this page's main thread, so the tab will stop responding while it runs. It will still be attempted.",
  converting: 'Converting…',
  convert: 'Convert to Markdown',
  readFailed: 'Could not read this document',
  // {detail} is the parser's own reason, in English.
  error_notDocx:
    'This file could not be read as .docx. The older binary .doc, .rtf, .odt and Apple Pages formats are different files entirely — open one in Word, LibreOffice or Pages and save it as .docx first. ({detail})',
  error_tooLarge:
    'This document is {size} MB. The limit is {max} MB, because a .docx is compressed and the unzipped XML, the HTML and the Markdown all have to be held in the tab at once. Split the document, or save a copy with the images removed, and try again.',
  imageEmbeddedOne: '1 image was embedded as a data URI.',
  imagesEmbedded: '{n} images were embedded as data URIs.',
  imageDroppedOne: '1 image was dropped.',
  imagesDropped: '{n} images were dropped.',
  noteOne: '1 note from the converter',
  notesMany: '{n} notes from the converter',
  downloadMd: 'Download .md',
  // {link} is the Markdown ↔ HTML tool link.
  previewNote:
    'Rendered with the same converter as the {link}, inside a sandboxed frame that cannot run script and cannot load anything from the network — so a link or an image address inside your document stays a piece of text and never becomes a request.',
  mdHtmlLink: 'Markdown ↔ HTML tool',
  previewTitle: 'Markdown preview',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'DOCX sang Markdown',
    docLabel: 'Tài liệu Word (.docx)',
    docxOnly: 'Chỉ nhận .docx.',
    formatNote:
      'File nhị phân cũ {doc}, cùng với {rtf}, {odt} và file Apple Pages là định dạng khác — hãy mở bằng Word, LibreOffice hoặc Pages rồi {saveAs} trước.',
    saveAs: 'Lưu thành → .docx',
    embedImages: 'Nhúng ảnh dạng data URI (mặc định tắt — một tấm ảnh có thể thêm vài MB base64)',
    tooLarge:
      'Tài liệu này nặng {size} MB, vượt giới hạn {max} MB. File .docx được nén, còn XML sau giải nén, HTML và Markdown đều phải nằm trong tab cùng lúc. Hãy tách tài liệu, hoặc lưu một bản đã bỏ ảnh, rồi thử lại.',
    slow: 'Tài liệu này lớn hơn 20 MB. Việc chuyển đổi chạy trên luồng chính của trang, nên tab sẽ đứng trong lúc xử lý. Vẫn sẽ thử xử lý.',
    converting: 'Đang chuyển đổi…',
    convert: 'Chuyển sang Markdown',
    readFailed: 'Không đọc được tài liệu này',
    error_notDocx:
      'Không đọc được tệp này dưới dạng .docx. Các định dạng .doc nhị phân cũ, .rtf, .odt và Apple Pages là những loại tệp hoàn toàn khác — hãy mở trong Word, LibreOffice hoặc Pages rồi lưu thành .docx trước. ({detail})',
    error_tooLarge:
      'Tài liệu này nặng {size} MB. Giới hạn là {max} MB, vì file .docx được nén, còn XML sau giải nén, HTML và Markdown đều phải nằm trong tab cùng lúc. Hãy tách tài liệu, hoặc lưu một bản đã bỏ ảnh, rồi thử lại.',
    imageEmbeddedOne: 'Đã nhúng 1 ảnh dạng data URI.',
    imagesEmbedded: 'Đã nhúng {n} ảnh dạng data URI.',
    imageDroppedOne: 'Đã bỏ 1 ảnh.',
    imagesDropped: 'Đã bỏ {n} ảnh.',
    noteOne: '1 ghi chú từ bộ chuyển đổi',
    notesMany: '{n} ghi chú từ bộ chuyển đổi',
    downloadMd: 'Tải .md',
    previewNote:
      'Hiển thị bằng cùng bộ chuyển đổi với {link}, trong một khung sandbox không chạy được script và không tải được gì từ mạng — nên đường link hay địa chỉ ảnh trong tài liệu chỉ là văn bản, không bao giờ thành request.',
    mdHtmlLink: 'công cụ Markdown ↔ HTML',
    previewTitle: 'Xem trước Markdown',
  },
  es: {
    title: 'DOCX a Markdown',
    docLabel: 'Documento de Word (.docx)',
    docxOnly: 'Solo .docx.',
    formatNote:
      'El antiguo binario {doc}, junto con {rtf}, {odt} y los archivos de Apple Pages, son formatos distintos — ábrelos en Word, LibreOffice o Pages y usa {saveAs} primero.',
    saveAs: 'Guardar como → .docx',
    embedImages:
      'Incrustar imágenes como data URI (desactivado por defecto — una foto puede añadir megabytes de base64)',
    tooLarge:
      'Este documento pesa {size} MB, por encima del límite de {max} MB. Un .docx está comprimido, y el XML descomprimido, el HTML y el Markdown deben estar en la pestaña a la vez. Divide el documento, o guarda una copia sin las imágenes, e inténtalo de nuevo.',
    slow: 'Este documento supera los 20 MB. La conversión se ejecuta en el hilo principal de la página, así que la pestaña dejará de responder mientras dure. Se intentará de todos modos.',
    converting: 'Convirtiendo…',
    convert: 'Convertir a Markdown',
    readFailed: 'No se pudo leer este documento',
    error_notDocx:
      'Este archivo no se pudo leer como .docx. El antiguo .doc binario, junto con .rtf, .odt y los archivos de Apple Pages, son formatos completamente distintos — ábrelo en Word, LibreOffice o Pages y guárdalo como .docx primero. ({detail})',
    error_tooLarge:
      'Este documento pesa {size} MB. El límite es {max} MB, porque un .docx está comprimido y el XML descomprimido, el HTML y el Markdown deben estar en la pestaña a la vez. Divide el documento, o guarda una copia sin las imágenes, e inténtalo de nuevo.',
    imageEmbeddedOne: 'Se incrustó 1 imagen como data URI.',
    imagesEmbedded: 'Se incrustaron {n} imágenes como data URI.',
    imageDroppedOne: 'Se descartó 1 imagen.',
    imagesDropped: 'Se descartaron {n} imágenes.',
    noteOne: '1 nota del conversor',
    notesMany: '{n} notas del conversor',
    downloadMd: 'Descargar .md',
    previewNote:
      'Renderizado con el mismo conversor que la {link}, dentro de un marco aislado que no puede ejecutar script ni cargar nada de la red — así que un enlace o la dirección de una imagen dentro de tu documento sigue siendo texto y nunca se convierte en una petición.',
    mdHtmlLink: 'herramienta Markdown ↔ HTML',
    previewTitle: 'Vista previa de Markdown',
  },
  pt: {
    title: 'DOCX para Markdown',
    docLabel: 'Documento do Word (.docx)',
    docxOnly: 'Somente .docx.',
    formatNote:
      'O antigo binário {doc}, junto com {rtf}, {odt} e arquivos do Apple Pages, são formatos diferentes — abra no Word, LibreOffice ou Pages e use {saveAs} primeiro.',
    saveAs: 'Salvar como → .docx',
    embedImages:
      'Incorporar imagens como data URI (desligado por padrão — uma foto pode adicionar megabytes de base64)',
    tooLarge:
      'Este documento tem {size} MB, acima do limite de {max} MB. Um .docx é compactado, e o XML descompactado, o HTML e o Markdown precisam ficar na aba ao mesmo tempo. Divida o documento, ou salve uma cópia sem as imagens, e tente novamente.',
    slow: 'Este documento passa de 20 MB. A conversão roda na thread principal da página, então a aba vai parar de responder enquanto durar. Ainda assim será tentado.',
    converting: 'Convertendo…',
    convert: 'Converter para Markdown',
    readFailed: 'Não foi possível ler este documento',
    error_notDocx:
      'Este arquivo não pôde ser lido como .docx. O antigo .doc binário, junto com .rtf, .odt e arquivos do Apple Pages, são formatos totalmente diferentes — abra-o no Word, LibreOffice ou Pages e salve como .docx primeiro. ({detail})',
    error_tooLarge:
      'Este documento tem {size} MB. O limite é {max} MB, porque um .docx é compactado e o XML descompactado, o HTML e o Markdown precisam ficar na aba ao mesmo tempo. Divida o documento, ou salve uma cópia sem as imagens, e tente novamente.',
    imageEmbeddedOne: '1 imagem foi incorporada como data URI.',
    imagesEmbedded: '{n} imagens foram incorporadas como data URI.',
    imageDroppedOne: '1 imagem foi descartada.',
    imagesDropped: '{n} imagens foram descartadas.',
    noteOne: '1 observação do conversor',
    notesMany: '{n} observações do conversor',
    downloadMd: 'Baixar .md',
    previewNote:
      'Renderizado com o mesmo conversor da {link}, dentro de um quadro isolado que não executa script nem carrega nada da rede — assim um link ou endereço de imagem dentro do seu documento continua sendo texto e nunca vira uma requisição.',
    mdHtmlLink: 'ferramenta Markdown ↔ HTML',
    previewTitle: 'Pré-visualização do Markdown',
  },
};
