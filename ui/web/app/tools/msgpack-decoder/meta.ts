import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'msgpack-decoder',
  cluster: 'converters',
  title: {
    en: 'MessagePack ↔ JSON',
    vi: 'MessagePack ↔ JSON',
    es: 'MessagePack ↔ JSON',
    pt: 'MessagePack ↔ JSON',
  },
  description: {
    en: 'Decode a MessagePack payload to JSON, or encode JSON to MessagePack, with a byte-count comparison. Accepts hex, Base64, or an uploaded .msgpack file. Browser-only.',
    vi: 'Giải mã payload MessagePack ra JSON, hoặc mã hóa JSON thành MessagePack, kèm so sánh dung lượng. Nhận hex, Base64, hoặc file .msgpack tải lên. Chỉ chạy trong trình duyệt.',
    es: 'Decodifica un payload MessagePack a JSON, o codifica JSON a MessagePack, con una comparación de tamaño en bytes. Acepta hex, Base64 o un archivo .msgpack. Solo en el navegador.',
    pt: 'Decodifique um payload MessagePack para JSON, ou codifique JSON para MessagePack, com comparação de tamanho em bytes. Aceita hex, Base64 ou um arquivo .msgpack. Só no navegador.',
  },
  keywords: [
    'messagepack decoder',
    'msgpack to json',
    'json to msgpack',
    'messagepack online',
    'decode msgpack file',
    'binary json format',
  ],
  priority: 'P2',
  effort: 'M',
  nextStepSuggestions: [
    {
      tool: 'protobuf-decoder',
      reason: {
        en: 'Another compact binary format — Protocol Buffers',
        vi: 'Một định dạng nhị phân gọn khác — Protocol Buffers',
        es: 'Otro formato binario compacto — Protocol Buffers',
        pt: 'Outro formato binário compacto — Protocol Buffers',
      },
    },
    {
      tool: 'json-formatter',
      reason: {
        en: 'Format or validate the JSON before encoding it',
        vi: 'Định dạng hoặc kiểm tra JSON trước khi mã hóa',
        es: 'Formatea o valida el JSON antes de codificarlo',
        pt: 'Formate ou valide o JSON antes de codificar',
      },
    },
  ],
};
