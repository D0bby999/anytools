import { type LocalizedStrings, useLocalized } from './tool-locale';

/**
 * Labels that recur across most tool widgets. Tools reuse these through `useUiStrings()`
 * instead of translating "Output" / "Clear" / "Copy" a hundred times over.
 */
const EN = {
  copy: 'Copy',
  copied: 'Copied',
  close: 'Close',
  swapUnits: 'Swap units',
  privacyNote: 'Runs entirely in your browser. Your input never leaves your device.',
  output: 'Output',
  input: 'Input',
  clear: 'Clear',
  tryExample: 'Try example',
  waitingForInput: 'Waiting for input…',
  conversionFailed: 'Conversion failed',
  invalidInput: 'Invalid input',
  encode: 'Encode',
  decode: 'Decode',
  uppercase: 'Uppercase',
  none: '(none)',
  typeText: 'Type text...',
};

export const UI_STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    copy: 'Sao chép',
    copied: 'Đã chép',
    close: 'Đóng',
    swapUnits: 'Đổi chiều đơn vị',
    privacyNote: 'Chạy hoàn toàn trong trình duyệt. Dữ liệu của bạn không rời khỏi thiết bị.',
    output: 'Kết quả',
    input: 'Đầu vào',
    clear: 'Xóa',
    tryExample: 'Thử ví dụ',
    waitingForInput: 'Đang chờ nhập…',
    conversionFailed: 'Chuyển đổi thất bại',
    invalidInput: 'Dữ liệu không hợp lệ',
    encode: 'Mã hóa',
    decode: 'Giải mã',
    uppercase: 'Chữ hoa',
    none: '(không)',
    typeText: 'Nhập văn bản...',
  },
  es: {
    copy: 'Copiar',
    copied: 'Copiado',
    close: 'Cerrar',
    swapUnits: 'Intercambiar unidades',
    privacyNote:
      'Se ejecuta completamente en tu navegador. Tus datos nunca salen de tu dispositivo.',
    output: 'Resultado',
    input: 'Entrada',
    clear: 'Limpiar',
    tryExample: 'Probar ejemplo',
    waitingForInput: 'Esperando entrada…',
    conversionFailed: 'La conversión falló',
    invalidInput: 'Entrada no válida',
    encode: 'Codificar',
    decode: 'Decodificar',
    uppercase: 'Mayúsculas',
    none: '(ninguno)',
    typeText: 'Escribe texto...',
  },
  pt: {
    copy: 'Copiar',
    copied: 'Copiado',
    close: 'Fechar',
    swapUnits: 'Trocar unidades',
    privacyNote: 'Roda totalmente no seu navegador. Seus dados nunca saem do seu dispositivo.',
    output: 'Resultado',
    input: 'Entrada',
    clear: 'Limpar',
    tryExample: 'Testar exemplo',
    waitingForInput: 'Aguardando entrada…',
    conversionFailed: 'A conversão falhou',
    invalidInput: 'Entrada inválida',
    encode: 'Codificar',
    decode: 'Decodificar',
    uppercase: 'Maiúsculas',
    none: '(nenhum)',
    typeText: 'Digite o texto...',
  },
};

export function useUiStrings() {
  return useLocalized(UI_STRINGS);
}
