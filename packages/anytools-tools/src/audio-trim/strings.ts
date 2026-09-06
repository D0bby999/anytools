import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Audio Trim',
  fileLabel: 'Audio file (mp3, wav, ogg, m4a — whatever your browser can decode)',
  decoding: 'Decoding…',
  dragHint: 'Drag the shaded region to choose what to keep, or drag its edges to resize it.',
  play: 'Play selection',
  pause: 'Pause',
  cut: 'Cut & convert to .wav',
  cutting: 'Cutting…',
  selection: 'Selection: {start}s – {end}s ({dur}s)',
  // {size} formatted bytes
  outputSize: 'Output will be about {size}',
  downloadWav: 'Download .wav',
  decodeFailed:
    'Your browser could not decode this file. It may be corrupted, or in a format this browser does not support.',
  cutFailed: 'Could not cut this selection.',
  error_rangeOutOfBounds: 'The selected range ({start}–{end}) is outside the {duration} clip.',
  error_rangeTooShort: 'Select at least {min} of audio — the current selection is {got}.',
  // {n} channels, {in} / {out} formatted sizes
  summary: '{n} channel(s) · {in} in, {out} out',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Cắt Audio',
    fileLabel: 'File âm thanh (mp3, wav, ogg, m4a — bất cứ gì trình duyệt giải mã được)',
    decoding: 'Đang giải mã…',
    dragHint: 'Kéo vùng bôi để chọn đoạn cần giữ, hoặc kéo hai cạnh để đổi kích thước.',
    play: 'Nghe đoạn đã chọn',
    pause: 'Dừng',
    cut: 'Cắt & chuyển sang .wav',
    cutting: 'Đang cắt…',
    selection: 'Đoạn chọn: {start}s – {end}s ({dur}s)',
    outputSize: 'File ra ước tính khoảng {size}',
    downloadWav: 'Tải file .wav',
    decodeFailed:
      'Trình duyệt không giải mã được file này. File có thể hỏng, hoặc định dạng chưa được trình duyệt này hỗ trợ.',
    cutFailed: 'Không thể cắt đoạn đã chọn.',
    error_rangeOutOfBounds: 'Đoạn chọn ({start}–{end}) nằm ngoài đoạn audio dài {duration}.',
    error_rangeTooShort: 'Chọn ít nhất {min} audio — đoạn hiện tại chỉ {got}.',
    summary: '{n} kênh · vào {in}, ra {out}',
  },
  es: {
    title: 'Recortar Audio',
    fileLabel: 'Archivo de audio (mp3, wav, ogg, m4a — lo que tu navegador pueda decodificar)',
    decoding: 'Decodificando…',
    dragHint:
      'Arrastra la zona sombreada para elegir qué conservar, o sus bordes para cambiar el tamaño.',
    play: 'Reproducir selección',
    pause: 'Pausar',
    cut: 'Recortar y convertir a .wav',
    cutting: 'Recortando…',
    selection: 'Selección: {start}s – {end}s ({dur}s)',
    outputSize: 'El archivo de salida pesará unos {size}',
    downloadWav: 'Descargar .wav',
    decodeFailed:
      'Tu navegador no pudo decodificar este archivo. Puede estar dañado o en un formato que este navegador no admite.',
    cutFailed: 'No se pudo recortar esta selección.',
    error_rangeOutOfBounds:
      'El rango seleccionado ({start}–{end}) queda fuera del clip de {duration}.',
    error_rangeTooShort: 'Selecciona al menos {min} de audio — la selección actual es de {got}.',
    summary: '{n} canal(es) · {in} de entrada, {out} de salida',
  },
  pt: {
    title: 'Cortar Áudio',
    fileLabel: 'Arquivo de áudio (mp3, wav, ogg, m4a — o que seu navegador conseguir decodificar)',
    decoding: 'Decodificando…',
    dragHint:
      'Arraste a região sombreada para escolher o que manter, ou as bordas para redimensionar.',
    play: 'Tocar seleção',
    pause: 'Pausar',
    cut: 'Cortar e converter para .wav',
    cutting: 'Cortando…',
    selection: 'Seleção: {start}s – {end}s ({dur}s)',
    outputSize: 'O arquivo de saída deve ter cerca de {size}',
    downloadWav: 'Baixar .wav',
    decodeFailed:
      'Seu navegador não conseguiu decodificar este arquivo. Ele pode estar corrompido, ou em um formato que este navegador não suporta.',
    cutFailed: 'Não foi possível cortar esta seleção.',
    error_rangeOutOfBounds:
      'O intervalo selecionado ({start}–{end}) está fora do trecho de {duration}.',
    error_rangeTooShort: 'Selecione pelo menos {min} de áudio — a seleção atual é de {got}.',
    summary: '{n} canal(is) · {in} de entrada, {out} de saída',
  },
};
