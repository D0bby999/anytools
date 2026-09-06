import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Protobuf Decoder',
  modeSchema: 'With .proto',
  modeBlind: 'Blind (wire format only)',
  protoLabel: '.proto source',
  protoPlaceholder: 'syntax = "proto3";\nmessage Person {\n  string name = 1;\n  int32 id = 2;\n}',
  messageTypeLabel: 'Message type',
  noTypesFound: 'No message types found yet — paste a .proto source above.',
  payloadLabel: 'Payload',
  payloadPlaceholder: 'Paste hex or Base64…',
  encodingLabel: 'Encoding',
  hex: 'Hex',
  base64: 'Base64',
  waiting: 'Paste a payload to decode…',
  fieldLabel: 'Field {n}',
  nestedGuess: 'nested message (guess)',
  blindNote:
    'No schema, so field names and exact types are unknown. Every value below is shown as several candidate interpretations — pick the one that matches what you expect.',
  error_invalidProto: '.proto source could not be parsed: {detail}',
  error_typeNotFound: 'Message type "{messageType}" was not found in the .proto source.',
  error_decodeFailed: 'This payload does not decode as {messageType}: {detail}',
  error_wireFormatDecodeFailed: 'This does not decode as protobuf wire format: {detail}.',
  error_emptyPayload: 'Paste or upload a payload first.',
  error_notHexDigit: '"{char}" is not a hex digit — expected 0-9 and a-f',
  error_hexOddLength: 'Hex string has an odd number of digits.',
  error_invalidBase64Input: 'This is not valid Base64.',
  error_payloadTooLarge:
    'This payload is {size}, above the {max} this tool decodes in the browser.',
};

/** For components (WireFieldRow) that need the resolved-strings shape without calling the hook. */
export type ProtobufDecoderStrings = typeof EN;

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Giải mã Protobuf',
    modeSchema: 'Có .proto',
    modeBlind: 'Giải mã mù (chỉ theo wire format)',
    protoLabel: 'Mã nguồn .proto',
    protoPlaceholder:
      'syntax = "proto3";\nmessage Person {\n  string name = 1;\n  int32 id = 2;\n}',
    messageTypeLabel: 'Loại message',
    noTypesFound: 'Chưa tìm thấy message nào — hãy dán mã nguồn .proto ở trên.',
    payloadLabel: 'Payload',
    payloadPlaceholder: 'Dán hex hoặc Base64…',
    encodingLabel: 'Định dạng',
    hex: 'Hex',
    base64: 'Base64',
    waiting: 'Dán payload để giải mã…',
    fieldLabel: 'Trường {n}',
    nestedGuess: 'message lồng (đoán)',
    blindNote:
      'Không có schema nên không biết tên trường và kiểu chính xác. Mỗi giá trị dưới đây hiện vài cách hiểu khác nhau — chọn cách khớp với những gì bạn mong đợi.',
    error_invalidProto: 'Không phân tích được mã nguồn .proto: {detail}',
    error_typeNotFound: 'Không tìm thấy loại message "{messageType}" trong mã nguồn .proto.',
    error_decodeFailed: 'Payload này không giải mã được thành {messageType}: {detail}',
    error_wireFormatDecodeFailed:
      'Dữ liệu này không giải mã được theo wire format protobuf: {detail}.',
    error_emptyPayload: 'Hãy dán hoặc tải lên payload trước.',
    error_notHexDigit: '"{char}" không phải chữ số hex — cần 0-9 và a-f',
    error_hexOddLength: 'Chuỗi hex có số chữ số lẻ.',
    error_invalidBase64Input: 'Đây không phải Base64 hợp lệ.',
    error_payloadTooLarge:
      'Payload này nặng {size}, vượt mức {max} mà công cụ này giải mã được trong trình duyệt.',
  },
  es: {
    title: 'Decodificador de Protobuf',
    modeSchema: 'Con .proto',
    modeBlind: 'A ciegas (solo wire format)',
    protoLabel: 'Fuente .proto',
    protoPlaceholder:
      'syntax = "proto3";\nmessage Person {\n  string name = 1;\n  int32 id = 2;\n}',
    messageTypeLabel: 'Tipo de mensaje',
    noTypesFound: 'Aún no se encontró ningún mensaje — pega una fuente .proto arriba.',
    payloadLabel: 'Payload',
    payloadPlaceholder: 'Pega hex o Base64…',
    encodingLabel: 'Codificación',
    hex: 'Hex',
    base64: 'Base64',
    waiting: 'Pega un payload para decodificar…',
    fieldLabel: 'Campo {n}',
    nestedGuess: 'mensaje anidado (conjetura)',
    blindNote:
      'Sin esquema, no se conocen los nombres ni los tipos exactos. Cada valor de abajo muestra varias interpretaciones posibles — elige la que coincida con lo que esperas.',
    error_invalidProto: 'No se pudo analizar la fuente .proto: {detail}',
    error_typeNotFound: 'No se encontró el tipo de mensaje "{messageType}" en la fuente .proto.',
    error_decodeFailed: 'Este payload no decodifica como {messageType}: {detail}',
    error_wireFormatDecodeFailed: 'Esto no decodifica como wire format de protobuf: {detail}.',
    error_emptyPayload: 'Pega o sube un payload primero.',
    error_notHexDigit: '"{char}" no es un dígito hexadecimal — se esperaba 0-9 y a-f',
    error_hexOddLength: 'La cadena hex tiene un número impar de dígitos.',
    error_invalidBase64Input: 'Esto no es Base64 válido.',
    error_payloadTooLarge:
      'Este payload pesa {size}, por encima de los {max} que esta herramienta decodifica en el navegador.',
  },
  pt: {
    title: 'Decodificador de Protobuf',
    modeSchema: 'Com .proto',
    modeBlind: 'Às cegas (só wire format)',
    protoLabel: 'Fonte .proto',
    protoPlaceholder:
      'syntax = "proto3";\nmessage Person {\n  string name = 1;\n  int32 id = 2;\n}',
    messageTypeLabel: 'Tipo de mensagem',
    noTypesFound: 'Nenhuma mensagem encontrada ainda — cole uma fonte .proto acima.',
    payloadLabel: 'Payload',
    payloadPlaceholder: 'Cole hex ou Base64…',
    encodingLabel: 'Codificação',
    hex: 'Hex',
    base64: 'Base64',
    waiting: 'Cole um payload para decodificar…',
    fieldLabel: 'Campo {n}',
    nestedGuess: 'mensagem aninhada (suposição)',
    blindNote:
      'Sem esquema, não se sabe os nomes de campo nem os tipos exatos. Cada valor abaixo mostra várias interpretações possíveis — escolha a que combina com o que você espera.',
    error_invalidProto: 'Não foi possível analisar a fonte .proto: {detail}',
    error_typeNotFound: 'Tipo de mensagem "{messageType}" não encontrado na fonte .proto.',
    error_decodeFailed: 'Este payload não decodifica como {messageType}: {detail}',
    error_wireFormatDecodeFailed: 'Isso não decodifica como wire format de protobuf: {detail}.',
    error_emptyPayload: 'Cole ou envie um payload primeiro.',
    error_notHexDigit: '"{char}" não é um dígito hexadecimal — esperado 0-9 e a-f',
    error_hexOddLength: 'A string hex tem um número ímpar de dígitos.',
    error_invalidBase64Input: 'Isso não é Base64 válido.',
    error_payloadTooLarge:
      'Este payload tem {size}, acima dos {max} que esta ferramenta decodifica no navegador.',
  },
};
