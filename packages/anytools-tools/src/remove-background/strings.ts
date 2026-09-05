import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Remove Image Background',
  dropLabel: 'Image (PNG, JPEG, WebP, AVIF, GIF)',
  cancelled: 'Download cancelled — nothing was changed.',
  failed: 'Background removal failed',
  firstRunNote:
    'The first run downloads a 4.4 MB model and a 14 MB runtime and keeps both in your browser’s cache — later runs, in this tab or after a reload, download nothing. The image itself is never uploaded.',
  // {v} is either the soft-mask label or a percentage such as "50%".
  cutoff: 'Cut-off: {v}',
  softMask: 'soft mask',
  edgeSoftness: 'Edge softness: {n} px',
  background: 'Background',
  bg_transparent: 'Transparent',
  bg_white: 'White',
  bg_custom: 'Solid colour…',
  fillWith: 'Fill the removed area with {colour}',
  cutoffNote:
    'Cut-off 0 keeps the model’s soft mask, which suits fur and motion blur; a higher cut-off gives a cleaner, harder edge. Edge softness blurs that edge afterwards.',
  working: 'Working…',
  removeBackground: 'Remove background',
  cancelDownload: 'Cancel download',
  runningModel: 'Running the model on your image…',
  downloadingEngine: 'Downloading the engine — {pct}%',
  downloadingModel: 'Downloading the model — {pct}%',
  loadingFirstRun: 'Loading the engine and model (first run only)…',
  resultLine: '{w} × {h} px · kept {kept}% of the pixels, removed {removed}% · {ms} ms',
  scaledNote:
    'Scaled down from {w} × {h} px. Above 8 megapixels the cutout is produced at a smaller size — the mask itself is predicted at 320 × 320 whatever the input, so the extra pixels add no detail to the edge, only memory and time.',
  cutoutAlt: 'Cutout',
  download: 'Download {name}',
  modelNote:
    'The model is u2netp, a small open one from 2020. It is solid on a clear subject against a contrasting background, and weak on hair, fur, glass and backgrounds the same colour as the subject. If the mask is wrong, no slider here will fix it.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Xóa nền ảnh',
    dropLabel: 'Ảnh (PNG, JPEG, WebP, AVIF, GIF)',
    cancelled: 'Đã hủy tải xuống — không có gì thay đổi.',
    failed: 'Xóa nền thất bại',
    firstRunNote:
      'Lần chạy đầu tải một mô hình 4,4 MB và một runtime 14 MB rồi giữ cả hai trong bộ nhớ đệm của trình duyệt — các lần sau, trong tab này hay sau khi tải lại trang, không tải gì thêm. Ảnh của bạn không bao giờ được tải lên.',
    cutoff: 'Ngưỡng cắt: {v}',
    softMask: 'mặt nạ mềm',
    edgeSoftness: 'Độ mềm viền: {n} px',
    background: 'Nền',
    bg_transparent: 'Trong suốt',
    bg_white: 'Trắng',
    bg_custom: 'Màu đơn sắc…',
    fillWith: 'Tô vùng đã xóa bằng màu {colour}',
    cutoffNote:
      'Ngưỡng 0 giữ nguyên mặt nạ mềm của mô hình, hợp với lông thú và chuyển động mờ; ngưỡng cao hơn cho viền sạch và sắc hơn. Độ mềm viền sẽ làm mờ viền đó sau cùng.',
    working: 'Đang xử lý…',
    removeBackground: 'Xóa nền',
    cancelDownload: 'Hủy tải xuống',
    runningModel: 'Đang chạy mô hình trên ảnh của bạn…',
    downloadingEngine: 'Đang tải engine — {pct}%',
    downloadingModel: 'Đang tải mô hình — {pct}%',
    loadingFirstRun: 'Đang nạp engine và mô hình (chỉ lần chạy đầu)…',
    resultLine: '{w} × {h} px · giữ {kept}% điểm ảnh, xóa {removed}% · {ms} ms',
    scaledNote:
      'Đã thu nhỏ từ {w} × {h} px. Trên 8 megapixel, ảnh cắt được tạo ở kích thước nhỏ hơn — mặt nạ luôn được dự đoán ở 320 × 320 bất kể đầu vào, nên điểm ảnh dư không thêm chi tiết cho viền, chỉ tốn bộ nhớ và thời gian.',
    cutoutAlt: 'Ảnh đã tách nền',
    download: 'Tải {name}',
    modelNote:
      'Mô hình là u2netp, một mô hình mở nhỏ từ năm 2020. Nó làm tốt với chủ thể rõ trên nền tương phản, và yếu với tóc, lông, thủy tinh và nền cùng màu với chủ thể. Nếu mặt nạ sai, không thanh trượt nào ở đây sửa được.',
  },
  es: {
    title: 'Eliminar fondo de imagen',
    dropLabel: 'Imagen (PNG, JPEG, WebP, AVIF, GIF)',
    cancelled: 'Descarga cancelada — no se cambió nada.',
    failed: 'La eliminación del fondo falló',
    firstRunNote:
      'La primera ejecución descarga un modelo de 4,4 MB y un runtime de 14 MB y guarda ambos en la caché de tu navegador — las siguientes, en esta pestaña o tras recargar, no descargan nada. La imagen en sí nunca se sube.',
    cutoff: 'Umbral: {v}',
    softMask: 'máscara suave',
    edgeSoftness: 'Suavidad del borde: {n} px',
    background: 'Fondo',
    bg_transparent: 'Transparente',
    bg_white: 'Blanco',
    bg_custom: 'Color sólido…',
    fillWith: 'Rellenar la zona eliminada con {colour}',
    cutoffNote:
      'Un umbral de 0 conserva la máscara suave del modelo, que va bien con pelo y desenfoque de movimiento; un umbral mayor da un borde más limpio y duro. La suavidad del borde lo difumina después.',
    working: 'Trabajando…',
    removeBackground: 'Eliminar fondo',
    cancelDownload: 'Cancelar descarga',
    runningModel: 'Ejecutando el modelo sobre tu imagen…',
    downloadingEngine: 'Descargando el motor — {pct}%',
    downloadingModel: 'Descargando el modelo — {pct}%',
    loadingFirstRun: 'Cargando el motor y el modelo (solo la primera vez)…',
    resultLine:
      '{w} × {h} px · conservado el {kept}% de los píxeles, eliminado el {removed}% · {ms} ms',
    scaledNote:
      'Reducida desde {w} × {h} px. Por encima de 8 megapíxeles el recorte se produce a un tamaño menor — la máscara se predice a 320 × 320 sea cual sea la entrada, así que los píxeles extra no añaden detalle al borde, solo memoria y tiempo.',
    cutoutAlt: 'Recorte',
    download: 'Descargar {name}',
    modelNote:
      'El modelo es u2netp, uno abierto y pequeño de 2020. Es sólido con un sujeto claro sobre un fondo contrastado, y flojo con pelo, pelaje, cristal y fondos del mismo color que el sujeto. Si la máscara está mal, ningún control de aquí lo arreglará.',
  },
  pt: {
    title: 'Remover fundo de imagem',
    dropLabel: 'Imagem (PNG, JPEG, WebP, AVIF, GIF)',
    cancelled: 'Download cancelado — nada foi alterado.',
    failed: 'A remoção do fundo falhou',
    firstRunNote:
      'A primeira execução baixa um modelo de 4,4 MB e um runtime de 14 MB e mantém ambos no cache do navegador — as seguintes, nesta aba ou após recarregar, não baixam nada. A imagem em si nunca é enviada.',
    cutoff: 'Limiar: {v}',
    softMask: 'máscara suave',
    edgeSoftness: 'Suavidade da borda: {n} px',
    background: 'Fundo',
    bg_transparent: 'Transparente',
    bg_white: 'Branco',
    bg_custom: 'Cor sólida…',
    fillWith: 'Preencher a área removida com {colour}',
    cutoffNote:
      'Limiar 0 mantém a máscara suave do modelo, boa para pelos e desfoque de movimento; um limiar maior dá uma borda mais limpa e dura. A suavidade da borda desfoca essa borda depois.',
    working: 'Trabalhando…',
    removeBackground: 'Remover fundo',
    cancelDownload: 'Cancelar download',
    runningModel: 'Executando o modelo na sua imagem…',
    downloadingEngine: 'Baixando o motor — {pct}%',
    downloadingModel: 'Baixando o modelo — {pct}%',
    loadingFirstRun: 'Carregando o motor e o modelo (só na primeira vez)…',
    resultLine: '{w} × {h} px · manteve {kept}% dos pixels, removeu {removed}% · {ms} ms',
    scaledNote:
      'Reduzida de {w} × {h} px. Acima de 8 megapixels o recorte é produzido em tamanho menor — a máscara é prevista em 320 × 320 seja qual for a entrada, então os pixels extras não acrescentam detalhe à borda, só memória e tempo.',
    cutoutAlt: 'Recorte',
    download: 'Baixar {name}',
    modelNote:
      'O modelo é o u2netp, um modelo aberto e pequeno de 2020. Ele é sólido com um assunto claro sobre um fundo contrastante, e fraco com cabelo, pelos, vidro e fundos da mesma cor do assunto. Se a máscara estiver errada, nenhum controle aqui vai corrigir.',
  },
};
