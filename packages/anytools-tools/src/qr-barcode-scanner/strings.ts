import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'QR & Barcode Scanner',
  dropLabel: 'Photo or screenshot containing the code',
  failed: 'This image could not be read.',
  cameraDenied:
    'Camera access was denied. Allow it in your browser’s site settings, or scan a photo instead.',
  cameraNotFound: 'No camera was found on this device. Drop a photo of the code instead.',
  cameraFailed:
    'The camera could not be started. On a plain http:// address other than localhost, browsers block it outright.',
  scanWithCamera: 'Scan with camera',
  stopCamera: 'Stop camera',
  scanning: 'Scanning…',
  scanAgain: 'Scan image again',
  cameraNote: 'The camera is off until you press the button, and stops the moment a code is read.',
  startingCamera: 'Starting camera…',
  noBarcode:
    'No barcode was found in that image. A blurred, angled or very small code often fails — crop closer to the code and try again.',
  readOne: '1 symbol read from the {source}.',
  readMany: '{n} symbols read from the {source}.',
  sourceCamera: 'camera',
  sourceImage: 'image',
  at: 'at {x}, {y}',
  webAddress: 'Web address —',
  openNewTab: 'open in a new tab',
  checkFirst: '. Check it before you do.',
  network: 'Network',
  password: 'Password',
  none: 'none',
  security: 'Security',
  hidden: 'Hidden',
  yes: 'yes',
  // {barcode} and {qr} are replaced with links to the two generators.
  makeCodeNote:
    'Need to make a code instead? The {barcode} covers EAN, UPC, Code 128 and the 2D symbologies, and the {qr} builds Wi-Fi, vCard and email codes that this tool reads straight back into fields.',
  barcodeGenerator: 'barcode generator',
  qrGenerator: 'QR code generator',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Quét mã QR & mã vạch',
    dropLabel: 'Ảnh hoặc ảnh chụp màn hình có chứa mã',
    failed: 'Không đọc được ảnh này.',
    cameraDenied:
      'Quyền truy cập camera bị từ chối. Hãy cho phép trong cài đặt trang web của trình duyệt, hoặc quét từ ảnh.',
    cameraNotFound: 'Không tìm thấy camera trên thiết bị này. Hãy thả ảnh chụp mã vào thay thế.',
    cameraFailed:
      'Không khởi động được camera. Với địa chỉ http:// thường (không phải localhost), trình duyệt chặn hoàn toàn.',
    scanWithCamera: 'Quét bằng camera',
    stopCamera: 'Tắt camera',
    scanning: 'Đang quét…',
    scanAgain: 'Quét lại ảnh',
    cameraNote: 'Camera chỉ bật khi bạn bấm nút, và tắt ngay khi đọc được mã.',
    startingCamera: 'Đang bật camera…',
    noBarcode:
      'Không tìm thấy mã vạch trong ảnh. Mã bị mờ, nghiêng hoặc quá nhỏ thường thất bại — hãy cắt sát mã hơn rồi thử lại.',
    readOne: 'Đọc được 1 mã từ {source}.',
    readMany: 'Đọc được {n} mã từ {source}.',
    sourceCamera: 'camera',
    sourceImage: 'ảnh',
    at: 'tại {x}, {y}',
    webAddress: 'Địa chỉ web —',
    openNewTab: 'mở trong tab mới',
    checkFirst: '. Hãy kiểm tra trước khi mở.',
    network: 'Mạng',
    password: 'Mật khẩu',
    none: 'không có',
    security: 'Bảo mật',
    hidden: 'Ẩn',
    yes: 'có',
    makeCodeNote:
      'Cần tạo mã thay vì đọc? {barcode} hỗ trợ EAN, UPC, Code 128 và các mã 2D, còn {qr} tạo mã Wi-Fi, vCard và email mà công cụ này đọc thẳng về từng trường.',
    barcodeGenerator: 'Trình tạo mã vạch',
    qrGenerator: 'trình tạo mã QR',
  },
  es: {
    title: 'Escáner de QR y códigos de barras',
    dropLabel: 'Foto o captura de pantalla que contenga el código',
    failed: 'No se pudo leer esta imagen.',
    cameraDenied:
      'Se denegó el acceso a la cámara. Permítelo en la configuración del sitio de tu navegador, o escanea una foto.',
    cameraNotFound:
      'No se encontró ninguna cámara en este dispositivo. Suelta una foto del código.',
    cameraFailed:
      'No se pudo iniciar la cámara. En una dirección http:// simple que no sea localhost, los navegadores la bloquean por completo.',
    scanWithCamera: 'Escanear con la cámara',
    stopCamera: 'Detener cámara',
    scanning: 'Escaneando…',
    scanAgain: 'Escanear la imagen de nuevo',
    cameraNote:
      'La cámara está apagada hasta que pulses el botón, y se detiene en cuanto se lee un código.',
    startingCamera: 'Iniciando cámara…',
    noBarcode:
      'No se encontró ningún código de barras en esa imagen. Un código borroso, inclinado o muy pequeño suele fallar — recorta más cerca del código e inténtalo de nuevo.',
    readOne: '1 símbolo leído de la {source}.',
    readMany: '{n} símbolos leídos de la {source}.',
    sourceCamera: 'cámara',
    sourceImage: 'imagen',
    at: 'en {x}, {y}',
    webAddress: 'Dirección web —',
    openNewTab: 'abrir en una pestaña nueva',
    checkFirst: '. Revísala antes de hacerlo.',
    network: 'Red',
    password: 'Contraseña',
    none: 'ninguna',
    security: 'Seguridad',
    hidden: 'Oculta',
    yes: 'sí',
    makeCodeNote:
      '¿Necesitas crear un código? El {barcode} cubre EAN, UPC, Code 128 y las simbologías 2D, y el {qr} crea códigos de Wi-Fi, vCard y correo que esta herramienta vuelve a leer directamente en campos.',
    barcodeGenerator: 'generador de códigos de barras',
    qrGenerator: 'generador de códigos QR',
  },
  pt: {
    title: 'Leitor de QR e código de barras',
    dropLabel: 'Foto ou captura de tela contendo o código',
    failed: 'Não foi possível ler esta imagem.',
    cameraDenied:
      'O acesso à câmera foi negado. Permita nas configurações do site no navegador, ou escaneie uma foto.',
    cameraNotFound: 'Nenhuma câmera foi encontrada neste dispositivo. Solte uma foto do código.',
    cameraFailed:
      'Não foi possível iniciar a câmera. Em um endereço http:// simples que não seja localhost, os navegadores a bloqueiam totalmente.',
    scanWithCamera: 'Escanear com a câmera',
    stopCamera: 'Parar câmera',
    scanning: 'Escaneando…',
    scanAgain: 'Escanear a imagem de novo',
    cameraNote:
      'A câmera fica desligada até você apertar o botão, e para no instante em que um código é lido.',
    startingCamera: 'Iniciando câmera…',
    noBarcode:
      'Nenhum código de barras foi encontrado nessa imagem. Um código borrado, inclinado ou muito pequeno costuma falhar — recorte mais perto do código e tente de novo.',
    readOne: '1 símbolo lido da {source}.',
    readMany: '{n} símbolos lidos da {source}.',
    sourceCamera: 'câmera',
    sourceImage: 'imagem',
    at: 'em {x}, {y}',
    webAddress: 'Endereço web —',
    openNewTab: 'abrir em uma nova aba',
    checkFirst: '. Confira antes de abrir.',
    network: 'Rede',
    password: 'Senha',
    none: 'nenhuma',
    security: 'Segurança',
    hidden: 'Oculta',
    yes: 'sim',
    makeCodeNote:
      'Precisa criar um código? O {barcode} cobre EAN, UPC, Code 128 e as simbologias 2D, e o {qr} cria códigos de Wi-Fi, vCard e e-mail que esta ferramenta lê de volta direto em campos.',
    barcodeGenerator: 'gerador de código de barras',
    qrGenerator: 'gerador de QR code',
  },
};
