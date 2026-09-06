import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'audio-trim',
  cluster: 'converters',
  title: { en: 'Audio Trim', vi: 'Cắt Audio', es: 'Recortar Audio', pt: 'Cortar Áudio' },
  description: {
    en: 'Cut a clip out of an mp3, wav, ogg or m4a on a waveform, listen back, and download the result as a .wav. Runs in your browser — nothing is uploaded.',
    vi: 'Cắt một đoạn từ file mp3, wav, ogg hay m4a trên dạng sóng, nghe lại rồi tải về file .wav. Chạy trong trình duyệt, không tải file lên.',
    es: 'Recorta un fragmento de un mp3, wav, ogg o m4a sobre la forma de onda, escúchalo y descarga el resultado como .wav. Se ejecuta en tu navegador.',
    pt: 'Corte um trecho de um mp3, wav, ogg ou m4a na forma de onda, ouça e baixe o resultado como .wav. Roda no navegador.',
  },
  keywords: [
    'trim audio online',
    'cut mp3 online',
    'audio cutter browser',
    'waveform editor online',
    'crop audio clip',
    'mp3 to wav trim',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'create-zip',
      reason: {
        en: 'Bundle several trimmed clips into one download',
        vi: 'Gộp nhiều đoạn đã cắt vào một file tải xuống',
        es: 'Agrupa varios clips recortados en una descarga',
        pt: 'Junte vários trechos cortados em um único download',
      },
    },
    {
      tool: 'stl-obj-viewer',
      reason: {
        en: 'Another file viewer that runs entirely offline',
        vi: 'Một công cụ xem file khác chạy hoàn toàn offline',
        es: 'Otro visor de archivos que funciona totalmente sin conexión',
        pt: 'Outro visualizador de arquivo que roda totalmente offline',
      },
    },
  ],
};
