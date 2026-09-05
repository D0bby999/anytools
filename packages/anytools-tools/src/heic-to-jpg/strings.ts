import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'HEIC to JPG',
  dropLabel: 'HEIC or HEIF photos (.heic, .heif, .hif)',
  zipFailed: 'Could not build the zip',
  saveAs: 'Save as',
  jpgOption: 'JPG — opens everywhere',
  pngOption: 'PNG — lossless, much larger',
  quality: 'JPEG quality: {n}%',
  convertingProgress: 'Converting {done}/{total}…',
  converting: 'Converting…',
  convertOne: 'Convert photo',
  convertMany: 'Convert {n} photos',
  decoderNote:
    'The HEIC decoder is about 1 MB and is fetched from this site the first time you convert something — not when the page loads. Everything after that happens on this page.',
  burstOne:
    'One file holds more than one image — a Live Photo or a burst. The still frame the camera marked as the main one was converted; the other frames and the video are left in the original file.',
  burstMany:
    '{n} files hold more than one image — a Live Photo or a burst. The still frame the camera marked as the main one was converted; the other frames and the video are left in the original file.',
  scaledOne:
    'One photo was larger than a browser canvas draws reliably (16.7 megapixels) and was scaled down to fit — {sw} × {sh} became {w} × {h}. The original file is untouched.',
  scaledMany:
    '{n} photos were larger than a browser canvas draws reliably (16.7 megapixels) and were scaled down to fit — {sw} × {sh} became {w} × {h}. The original file is untouched.',
  downloadAllZip: 'Download all {n} as .zip',
  scaledFrom: '(scaled from {w} × {h})',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'HEIC sang JPG',
    dropLabel: 'Ảnh HEIC hoặc HEIF (.heic, .heif, .hif)',
    zipFailed: 'Không thể tạo tệp zip',
    saveAs: 'Lưu dưới dạng',
    jpgOption: 'JPG — mở được ở mọi nơi',
    pngOption: 'PNG — không mất dữ liệu, nặng hơn nhiều',
    quality: 'Chất lượng JPEG: {n}%',
    convertingProgress: 'Đang chuyển {done}/{total}…',
    converting: 'Đang chuyển đổi…',
    convertOne: 'Chuyển đổi ảnh',
    convertMany: 'Chuyển đổi {n} ảnh',
    decoderNote:
      'Bộ giải mã HEIC nặng khoảng 1 MB và được tải từ trang này ở lần chuyển đổi đầu tiên — không phải lúc mở trang. Mọi thứ sau đó diễn ra ngay trên trang.',
    burstOne:
      'Một tệp chứa nhiều hơn một ảnh — Live Photo hoặc chụp liên tiếp. Khung hình tĩnh mà camera đánh dấu là chính đã được chuyển đổi; các khung khác và video vẫn nằm trong tệp gốc.',
    burstMany:
      '{n} tệp chứa nhiều hơn một ảnh — Live Photo hoặc chụp liên tiếp. Khung hình tĩnh mà camera đánh dấu là chính đã được chuyển đổi; các khung khác và video vẫn nằm trong tệp gốc.',
    scaledOne:
      'Một ảnh lớn hơn mức canvas trình duyệt vẽ ổn định (16,7 megapixel) nên đã được thu nhỏ cho vừa — {sw} × {sh} thành {w} × {h}. Tệp gốc không thay đổi.',
    scaledMany:
      '{n} ảnh lớn hơn mức canvas trình duyệt vẽ ổn định (16,7 megapixel) nên đã được thu nhỏ cho vừa — {sw} × {sh} thành {w} × {h}. Tệp gốc không thay đổi.',
    downloadAllZip: 'Tải tất cả {n} ảnh dạng .zip',
    scaledFrom: '(thu nhỏ từ {w} × {h})',
  },
  es: {
    title: 'HEIC a JPG',
    dropLabel: 'Fotos HEIC o HEIF (.heic, .heif, .hif)',
    zipFailed: 'No se pudo generar el zip',
    saveAs: 'Guardar como',
    jpgOption: 'JPG — se abre en todas partes',
    pngOption: 'PNG — sin pérdida, mucho más grande',
    quality: 'Calidad JPEG: {n}%',
    convertingProgress: 'Convirtiendo {done}/{total}…',
    converting: 'Convirtiendo…',
    convertOne: 'Convertir foto',
    convertMany: 'Convertir {n} fotos',
    decoderNote:
      'El decodificador HEIC pesa alrededor de 1 MB y se descarga de este sitio la primera vez que conviertes algo — no al cargar la página. Todo lo demás ocurre en esta página.',
    burstOne:
      'Un archivo contiene más de una imagen — una Live Photo o una ráfaga. Se convirtió el fotograma que la cámara marcó como principal; los demás fotogramas y el vídeo quedan en el archivo original.',
    burstMany:
      '{n} archivos contienen más de una imagen — una Live Photo o una ráfaga. Se convirtió el fotograma que la cámara marcó como principal; los demás fotogramas y el vídeo quedan en el archivo original.',
    scaledOne:
      'Una foto era más grande de lo que un canvas del navegador dibuja de forma fiable (16,7 megapíxeles) y se redujo para que quepa — {sw} × {sh} pasó a {w} × {h}. El archivo original no se toca.',
    scaledMany:
      '{n} fotos eran más grandes de lo que un canvas del navegador dibuja de forma fiable (16,7 megapíxeles) y se redujeron para que quepan — {sw} × {sh} pasó a {w} × {h}. El archivo original no se toca.',
    downloadAllZip: 'Descargar las {n} como .zip',
    scaledFrom: '(reducida desde {w} × {h})',
  },
  pt: {
    title: 'HEIC para JPG',
    dropLabel: 'Fotos HEIC ou HEIF (.heic, .heif, .hif)',
    zipFailed: 'Não foi possível gerar o zip',
    saveAs: 'Salvar como',
    jpgOption: 'JPG — abre em qualquer lugar',
    pngOption: 'PNG — sem perdas, bem maior',
    quality: 'Qualidade JPEG: {n}%',
    convertingProgress: 'Convertendo {done}/{total}…',
    converting: 'Convertendo…',
    convertOne: 'Converter foto',
    convertMany: 'Converter {n} fotos',
    decoderNote:
      'O decodificador HEIC tem cerca de 1 MB e é baixado deste site na primeira vez que você converte algo — não ao carregar a página. Tudo depois disso acontece nesta página.',
    burstOne:
      'Um arquivo contém mais de uma imagem — uma Live Photo ou uma sequência. O quadro que a câmera marcou como principal foi convertido; os outros quadros e o vídeo ficam no arquivo original.',
    burstMany:
      '{n} arquivos contêm mais de uma imagem — uma Live Photo ou uma sequência. O quadro que a câmera marcou como principal foi convertido; os outros quadros e o vídeo ficam no arquivo original.',
    scaledOne:
      'Uma foto era maior do que um canvas do navegador desenha com segurança (16,7 megapixels) e foi reduzida para caber — {sw} × {sh} virou {w} × {h}. O arquivo original não é alterado.',
    scaledMany:
      '{n} fotos eram maiores do que um canvas do navegador desenha com segurança (16,7 megapixels) e foram reduzidas para caber — {sw} × {sh} virou {w} × {h}. O arquivo original não é alterado.',
    downloadAllZip: 'Baixar todas as {n} como .zip',
    scaledFrom: '(reduzida de {w} × {h})',
  },
};
