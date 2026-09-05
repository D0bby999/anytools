import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'curl → Code Converter',
  target: 'Target',
  serverNote:
    'Unlike our other tools, this one does not run in your browser: parsing curl needs server-side native bindings. Your command is sent over HTTPS, parsed, and discarded — never logged or stored. Still, replace any real tokens, cookies or API keys first.',
  curlCommand: 'curl command',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển curl → mã nguồn',
    target: 'Ngôn ngữ đích',
    serverNote:
      'Khác với các công cụ còn lại, công cụ này không chạy trong trình duyệt: phân tích curl cần thư viện native phía máy chủ. Lệnh của bạn được gửi qua HTTPS, phân tích rồi bỏ đi — không ghi log, không lưu. Dù vậy, hãy thay các token, cookie hay API key thật trước khi dán.',
    curlCommand: 'Lệnh curl',
  },
  es: {
    title: 'Conversor de curl → código',
    target: 'Destino',
    serverNote:
      'A diferencia de nuestras otras herramientas, esta no se ejecuta en tu navegador: analizar curl requiere bindings nativos en el servidor. Tu comando se envía por HTTPS, se analiza y se descarta — nunca se registra ni se almacena. Aun así, reemplaza antes cualquier token, cookie o clave de API real.',
    curlCommand: 'Comando curl',
  },
  pt: {
    title: 'Conversor de curl → código',
    target: 'Destino',
    serverNote:
      'Diferente das nossas outras ferramentas, esta não roda no seu navegador: analisar curl exige bindings nativos no servidor. Seu comando é enviado por HTTPS, analisado e descartado — nunca registrado nem armazenado. Mesmo assim, substitua antes qualquer token, cookie ou chave de API real.',
    curlCommand: 'Comando curl',
  },
};
