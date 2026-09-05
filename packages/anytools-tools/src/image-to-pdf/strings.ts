import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Image to PDF',
  dropLabel: 'Images — drag to reorder, or use the arrows. One image per page, top to bottom.',
  failed: 'Could not build the PDF',
  pageSize: 'Page size',
  size_fit: 'Fit the page to each image',
  orientation: 'Orientation',
  orient_auto: 'Match each image',
  orient_portrait: 'Portrait',
  orient_landscape: 'Landscape',
  margin: 'Margin',
  margin_none: 'None',
  margin_narrow: 'Narrow — 6 mm',
  margin_normal: 'Normal — 13 mm',
  margin_wide: 'Wide — 25 mm',
  // {dpi} is the print resolution constant.
  downscale: 'Downscale to {dpi} dpi at the printed size',
  downscaleFitNote:
    'Not used when the page is sized to the image — shrinking would shrink the page.',
  downscaleNote:
    'Keeps a phone photo from adding several megabytes per page. Turn off to keep full resolution.',
  redrawNote:
    'Every image is re-drawn in this tab before it goes into the PDF. That is what applies the rotation flag a phone camera writes, and what lets WebP and GIF in at all — PDF itself stores only JPEG and PNG.',
  readingImage: 'Reading image {n} of {total}…',
  building: 'Building PDF…',
  createEmpty: 'Create PDF from images',
  createOne: 'Create PDF from 1 image',
  createMany: 'Create PDF from {n} images',
  pageCountOne: '{n} page',
  pageCountMany: '{n} pages',
  // {pixels} is "WxH", {page} is "WxH pt".
  sourceLine: '{name} — {pixels} px on a {page} page',
  download: 'Download images.pdf',
  error_marginTooLarge:
    'A margin of {margin} pt leaves no room on a {paper} page. Use less than {max} pt.',
  error_noImages: 'Choose at least one image.',
  error_imageEmbedFailed: '"{name}" could not be embedded as an image.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Ảnh sang PDF',
    dropLabel:
      'Ảnh — kéo để sắp xếp lại, hoặc dùng mũi tên. Mỗi ảnh một trang, theo thứ tự từ trên xuống.',
    failed: 'Không thể tạo PDF',
    pageSize: 'Khổ trang',
    size_fit: 'Khổ trang vừa với từng ảnh',
    orientation: 'Hướng trang',
    orient_auto: 'Theo từng ảnh',
    orient_portrait: 'Dọc',
    orient_landscape: 'Ngang',
    margin: 'Lề',
    margin_none: 'Không',
    margin_narrow: 'Hẹp — 6 mm',
    margin_normal: 'Vừa — 13 mm',
    margin_wide: 'Rộng — 25 mm',
    downscale: 'Giảm xuống {dpi} dpi theo kích thước in',
    downscaleFitNote: 'Không dùng khi khổ trang theo ảnh — thu nhỏ ảnh sẽ thu nhỏ luôn trang.',
    downscaleNote:
      'Tránh việc mỗi ảnh chụp điện thoại thêm vài megabyte cho mỗi trang. Tắt để giữ nguyên độ phân giải.',
    redrawNote:
      'Mọi ảnh đều được vẽ lại trong tab này trước khi đưa vào PDF. Nhờ vậy cờ xoay do camera điện thoại ghi được áp dụng, và WebP hay GIF mới dùng được — bản thân PDF chỉ lưu JPEG và PNG.',
    readingImage: 'Đang đọc ảnh {n}/{total}…',
    building: 'Đang tạo PDF…',
    createEmpty: 'Tạo PDF từ ảnh',
    createOne: 'Tạo PDF từ 1 ảnh',
    createMany: 'Tạo PDF từ {n} ảnh',
    pageCountOne: '{n} trang',
    pageCountMany: '{n} trang',
    sourceLine: '{name} — {pixels} px trên trang {page}',
    download: 'Tải images.pdf',
    error_marginTooLarge:
      'Lề {margin} pt không chừa chỗ nào trên trang {paper}. Hãy dùng dưới {max} pt.',
    error_noImages: 'Chọn ít nhất một ảnh.',
    error_imageEmbedFailed: 'Không nhúng được "{name}" dưới dạng ảnh.',
  },
  es: {
    title: 'Imagen a PDF',
    dropLabel:
      'Imágenes — arrastra para reordenar o usa las flechas. Una imagen por página, de arriba abajo.',
    failed: 'No se pudo generar el PDF',
    pageSize: 'Tamaño de página',
    size_fit: 'Ajustar la página a cada imagen',
    orientation: 'Orientación',
    orient_auto: 'Según cada imagen',
    orient_portrait: 'Vertical',
    orient_landscape: 'Horizontal',
    margin: 'Margen',
    margin_none: 'Ninguno',
    margin_narrow: 'Estrecho — 6 mm',
    margin_normal: 'Normal — 13 mm',
    margin_wide: 'Ancho — 25 mm',
    downscale: 'Reducir a {dpi} dpi al tamaño impreso',
    downscaleFitNote:
      'No se usa cuando la página se ajusta a la imagen — reducirla reduciría la página.',
    downscaleNote:
      'Evita que una foto de móvil añada varios megabytes por página. Desactívalo para conservar la resolución completa.',
    redrawNote:
      'Cada imagen se vuelve a dibujar en esta pestaña antes de entrar en el PDF. Eso es lo que aplica la marca de rotación que escribe la cámara del móvil, y lo que permite usar WebP y GIF — el PDF en sí solo guarda JPEG y PNG.',
    readingImage: 'Leyendo imagen {n} de {total}…',
    building: 'Generando PDF…',
    createEmpty: 'Crear PDF a partir de imágenes',
    createOne: 'Crear PDF a partir de 1 imagen',
    createMany: 'Crear PDF a partir de {n} imágenes',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    sourceLine: '{name} — {pixels} px en una página de {page}',
    download: 'Descargar images.pdf',
    error_marginTooLarge:
      'Un margen de {margin} pt no deja espacio en una página {paper}. Usa menos de {max} pt.',
    error_noImages: 'Elige al menos una imagen.',
    error_imageEmbedFailed: 'No se pudo incrustar "{name}" como imagen.',
  },
  pt: {
    title: 'Imagem para PDF',
    dropLabel:
      'Imagens — arraste para reordenar ou use as setas. Uma imagem por página, de cima para baixo.',
    failed: 'Não foi possível gerar o PDF',
    pageSize: 'Tamanho da página',
    size_fit: 'Ajustar a página a cada imagem',
    orientation: 'Orientação',
    orient_auto: 'Conforme cada imagem',
    orient_portrait: 'Retrato',
    orient_landscape: 'Paisagem',
    margin: 'Margem',
    margin_none: 'Nenhuma',
    margin_narrow: 'Estreita — 6 mm',
    margin_normal: 'Normal — 13 mm',
    margin_wide: 'Larga — 25 mm',
    downscale: 'Reduzir para {dpi} dpi no tamanho impresso',
    downscaleFitNote:
      'Não é usado quando a página se ajusta à imagem — encolher a imagem encolheria a página.',
    downscaleNote:
      'Evita que uma foto de celular adicione vários megabytes por página. Desative para manter a resolução completa.',
    redrawNote:
      'Cada imagem é redesenhada nesta aba antes de entrar no PDF. É isso que aplica a marca de rotação gravada pela câmera do celular e que permite usar WebP e GIF — o PDF em si só armazena JPEG e PNG.',
    readingImage: 'Lendo imagem {n} de {total}…',
    building: 'Gerando PDF…',
    createEmpty: 'Criar PDF a partir de imagens',
    createOne: 'Criar PDF a partir de 1 imagem',
    createMany: 'Criar PDF a partir de {n} imagens',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    sourceLine: '{name} — {pixels} px em uma página de {page}',
    download: 'Baixar images.pdf',
    error_marginTooLarge:
      'Uma margem de {margin} pt não deixa espaço em uma página {paper}. Use menos de {max} pt.',
    error_noImages: 'Escolha pelo menos uma imagem.',
    error_imageEmbedFailed: 'Não foi possível incorporar "{name}" como imagem.',
  },
};
