import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'YouTube Thumbnail Grabber',
  urlLabel: 'YouTube URL or video ID',
  urlPlaceholder: 'https://www.youtube.com/watch?v=… or youtu.be/…',
  error_notFound:
    'Could not find a YouTube video ID in that. Try a watch, youtu.be, shorts or embed link, or paste the 11-character ID directly.',
  error_networkFailed: "Could not reach YouTube's image server.",
  error_thumbnailMissing:
    'YouTube returned {status} for this thumbnail size — it may not exist for this video.',
  preview: 'Preview (best available quality)',
  resolution_maxresdefault: 'Max res',
  resolution_sddefault: 'SD',
  resolution_hqdefault: 'HQ',
  resolution_mqdefault: 'MQ',
  download: 'Download',
  openInNewTab: 'Open in new tab instead',
  downloadFailedNote:
    "Direct download didn't work — opened the image in a new tab so you can save it from there.",
  // {name} network host, shown in the custom privacy note below
  privacyNote:
    "Unlike every other tool on this site, this one talks to a server: your browser requests thumbnail images directly from {name}, YouTube's own image CDN. The video ID you enter reaches YouTube the moment an image loads. Nothing passes through our servers, and nothing else about you is sent — but this is not a fully local tool.",
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Lấy ảnh thumbnail YouTube',
    urlLabel: 'URL YouTube hoặc ID video',
    urlPlaceholder: 'https://www.youtube.com/watch?v=… hoặc youtu.be/…',
    error_notFound:
      'Không tìm thấy ID video YouTube trong đó. Thử link watch, youtu.be, shorts hoặc embed, hoặc dán thẳng ID 11 ký tự.',
    error_networkFailed: 'Không kết nối được tới máy chủ ảnh của YouTube.',
    error_thumbnailMissing:
      'YouTube trả về mã {status} cho độ phân giải này — có thể video không có ảnh này.',
    preview: 'Xem trước (chất lượng tốt nhất có sẵn)',
    resolution_maxresdefault: 'Max res',
    resolution_sddefault: 'SD',
    resolution_hqdefault: 'HQ',
    resolution_mqdefault: 'MQ',
    download: 'Tải xuống',
    openInNewTab: 'Mở tab mới thay thế',
    downloadFailedNote: 'Tải trực tiếp không thành công — đã mở ảnh ở tab mới để bạn lưu từ đó.',
    privacyNote:
      'Khác với mọi tool khác trên trang này, tool này có gọi tới máy chủ: trình duyệt của bạn tải ảnh thumbnail trực tiếp từ {name}, CDN ảnh của chính YouTube. ID video bạn nhập sẽ tới YouTube ngay khi ảnh tải. Không có gì đi qua máy chủ của chúng tôi, và không có thông tin nào khác về bạn được gửi đi — nhưng đây không phải tool chạy hoàn toàn cục bộ.',
  },
  es: {
    title: 'Extractor de miniaturas de YouTube',
    urlLabel: 'URL de YouTube o ID de video',
    urlPlaceholder: 'https://www.youtube.com/watch?v=… o youtu.be/…',
    error_notFound:
      'No se encontró un ID de video de YouTube ahí. Prueba un enlace watch, youtu.be, shorts o embed, o pega directamente el ID de 11 caracteres.',
    error_networkFailed: 'No se pudo conectar con el servidor de imágenes de YouTube.',
    error_thumbnailMissing:
      'YouTube devolvió {status} para esta resolución — puede que no exista para este video.',
    preview: 'Vista previa (mejor calidad disponible)',
    resolution_maxresdefault: 'Máx. res',
    resolution_sddefault: 'SD',
    resolution_hqdefault: 'HQ',
    resolution_mqdefault: 'MQ',
    download: 'Descargar',
    openInNewTab: 'Abrir en pestaña nueva',
    downloadFailedNote:
      'La descarga directa no funcionó — se abrió la imagen en una pestaña nueva para que la guardes desde ahí.',
    privacyNote:
      'A diferencia de cualquier otra herramienta en este sitio, esta sí habla con un servidor: tu navegador solicita las miniaturas directamente a {name}, el propio CDN de imágenes de YouTube. El ID del video que escribes llega a YouTube en cuanto carga una imagen. Nada pasa por nuestros servidores, y no se envía ninguna otra información sobre ti — pero esta no es una herramienta totalmente local.',
  },
  pt: {
    title: 'Extrator de miniaturas do YouTube',
    urlLabel: 'URL do YouTube ou ID do vídeo',
    urlPlaceholder: 'https://www.youtube.com/watch?v=… ou youtu.be/…',
    error_notFound:
      'Não foi encontrado um ID de vídeo do YouTube nisso. Tente um link watch, youtu.be, shorts ou embed, ou cole o ID de 11 caracteres diretamente.',
    error_networkFailed: 'Não foi possível conectar ao servidor de imagens do YouTube.',
    error_thumbnailMissing:
      'O YouTube retornou {status} para essa resolução — pode não existir para este vídeo.',
    preview: 'Prévia (melhor qualidade disponível)',
    resolution_maxresdefault: 'Máx. res',
    resolution_sddefault: 'SD',
    resolution_hqdefault: 'HQ',
    resolution_mqdefault: 'MQ',
    download: 'Baixar',
    openInNewTab: 'Abrir em nova aba',
    downloadFailedNote:
      'O download direto não funcionou — a imagem foi aberta em uma nova aba para você salvar por lá.',
    privacyNote:
      'Diferente de qualquer outra ferramenta neste site, esta fala com um servidor: seu navegador solicita as miniaturas diretamente de {name}, o próprio CDN de imagens do YouTube. O ID do vídeo que você digita chega ao YouTube assim que uma imagem carrega. Nada passa pelos nossos servidores, e nenhuma outra informação sobre você é enviada — mas esta não é uma ferramenta totalmente local.',
  },
};
