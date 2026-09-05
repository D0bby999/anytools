import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Compress Image',
  dropLabel: 'Image to compress (PNG, JPEG, WebP, AVIF, GIF)',
  failed: 'Compression failed',
  outputFormat: 'Output format',
  lossless: '(lossless)',
  targetSize: 'Target size (KB)',
  quality: 'Quality: {n}%',
  sizeBudget: 'Hit a size budget instead — finds the best quality that fits',
  pngNote:
    'PNG is lossless, so there is no quality setting. For photographs WebP will be far smaller at the same visual quality.',
  compressing: 'Compressing…',
  compress: 'Compress',
  alphaLoss:
    'This image has transparent areas and JPEG cannot store them — they have been filled in. Choose WebP or PNG to keep the transparency.',
  targetMissed:
    'Could not reach {target} KB even at the lowest quality — the result below is {actual} KB. Reduce the dimensions with Resize Image first; past a point, quality alone cannot get there.',
  decodedDown: '(decoded down from {w} × {h}, above the canvas ceiling)',
  smaller: '{n}% smaller',
  larger: '{n}% larger',
  original: 'Original',
  compressed: 'Compressed',
  originalSize: 'Original — {size}',
  compressedSize: 'Compressed — {size}',
  download: 'Download {name}',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Nén ảnh',
    dropLabel: 'Ảnh cần nén (PNG, JPEG, WebP, AVIF, GIF)',
    failed: 'Nén thất bại',
    outputFormat: 'Định dạng đầu ra',
    lossless: '(không mất dữ liệu)',
    targetSize: 'Dung lượng mục tiêu (KB)',
    quality: 'Chất lượng: {n}%',
    sizeBudget: 'Đặt ngưỡng dung lượng thay vì chất lượng — tự tìm chất lượng cao nhất vừa ngưỡng',
    pngNote:
      'PNG không mất dữ liệu nên không có tùy chọn chất lượng. Với ảnh chụp, WebP sẽ nhỏ hơn nhiều ở cùng chất lượng nhìn thấy.',
    compressing: 'Đang nén…',
    compress: 'Nén',
    alphaLoss:
      'Ảnh này có vùng trong suốt mà JPEG không lưu được — chúng đã bị tô kín. Chọn WebP hoặc PNG để giữ độ trong suốt.',
    targetMissed:
      'Không đạt được {target} KB ngay cả ở chất lượng thấp nhất — kết quả bên dưới là {actual} KB. Hãy giảm kích thước bằng công cụ Đổi cỡ ảnh trước; đến một mức nào đó, chỉ giảm chất lượng là không đủ.',
    decodedDown: '(giải mã xuống từ {w} × {h}, vượt giới hạn canvas)',
    smaller: 'nhỏ hơn {n}%',
    larger: 'lớn hơn {n}%',
    original: 'Ảnh gốc',
    compressed: 'Đã nén',
    originalSize: 'Ảnh gốc — {size}',
    compressedSize: 'Đã nén — {size}',
    download: 'Tải {name}',
  },
  es: {
    title: 'Comprimir imagen',
    dropLabel: 'Imagen a comprimir (PNG, JPEG, WebP, AVIF, GIF)',
    failed: 'La compresión falló',
    outputFormat: 'Formato de salida',
    lossless: '(sin pérdida)',
    targetSize: 'Tamaño objetivo (KB)',
    quality: 'Calidad: {n}%',
    sizeBudget: 'Ajustar a un tamaño máximo — busca la mejor calidad que quepa',
    pngNote:
      'PNG es sin pérdida, así que no hay ajuste de calidad. Para fotografías, WebP será mucho más pequeño con la misma calidad visual.',
    compressing: 'Comprimiendo…',
    compress: 'Comprimir',
    alphaLoss:
      'Esta imagen tiene zonas transparentes y JPEG no puede guardarlas — se han rellenado. Elige WebP o PNG para conservar la transparencia.',
    targetMissed:
      'No se pudieron alcanzar {target} KB ni con la calidad más baja — el resultado de abajo pesa {actual} KB. Reduce primero las dimensiones con Redimensionar imagen; a partir de cierto punto, la calidad por sí sola no basta.',
    decodedDown: '(decodificada desde {w} × {h}, por encima del límite del canvas)',
    smaller: '{n}% más pequeña',
    larger: '{n}% más grande',
    original: 'Original',
    compressed: 'Comprimida',
    originalSize: 'Original — {size}',
    compressedSize: 'Comprimida — {size}',
    download: 'Descargar {name}',
  },
  pt: {
    title: 'Comprimir imagem',
    dropLabel: 'Imagem a comprimir (PNG, JPEG, WebP, AVIF, GIF)',
    failed: 'A compressão falhou',
    outputFormat: 'Formato de saída',
    lossless: '(sem perdas)',
    targetSize: 'Tamanho alvo (KB)',
    quality: 'Qualidade: {n}%',
    sizeBudget: 'Definir um limite de tamanho — encontra a melhor qualidade que cabe',
    pngNote:
      'PNG é sem perdas, então não há ajuste de qualidade. Para fotografias, WebP será bem menor com a mesma qualidade visual.',
    compressing: 'Comprimindo…',
    compress: 'Comprimir',
    alphaLoss:
      'Esta imagem tem áreas transparentes e o JPEG não consegue guardá-las — elas foram preenchidas. Escolha WebP ou PNG para manter a transparência.',
    targetMissed:
      'Não foi possível chegar a {target} KB nem na qualidade mais baixa — o resultado abaixo tem {actual} KB. Reduza primeiro as dimensões com Redimensionar imagem; a partir de certo ponto, a qualidade sozinha não basta.',
    decodedDown: '(decodificada a partir de {w} × {h}, acima do limite do canvas)',
    smaller: '{n}% menor',
    larger: '{n}% maior',
    original: 'Original',
    compressed: 'Comprimida',
    originalSize: 'Original — {size}',
    compressedSize: 'Comprimida — {size}',
    download: 'Baixar {name}',
  },
};
