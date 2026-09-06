import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'protobuf-decoder',
  cluster: 'converters',
  title: {
    en: 'Protobuf Decoder',
    vi: 'Giải mã Protobuf',
    es: 'Decodificador de Protobuf',
    pt: 'Decodificador de Protobuf',
  },
  description: {
    en: 'Decode a Protocol Buffers payload to JSON — paste a .proto for real field names, or decode blind by wire format alone when you only have the bytes. Browser-only.',
    vi: 'Giải mã payload Protocol Buffers ra JSON — dán .proto để có tên trường thật, hoặc giải mã mù theo wire format khi chỉ có byte thô. Chỉ chạy trong trình duyệt.',
    es: 'Decodifica un payload de Protocol Buffers a JSON — pega un .proto para nombres de campo reales, o decodifica a ciegas por el wire format cuando solo tienes los bytes. Solo en el navegador.',
    pt: 'Decodifique um payload de Protocol Buffers para JSON — cole um .proto para nomes de campo reais, ou decodifique às cegas pelo wire format quando só tem os bytes. Só no navegador.',
  },
  keywords: [
    'protobuf decoder',
    'protocol buffers decoder',
    'decode protobuf online',
    'protobuf to json',
    'protobuf wire format',
    'proto decoder without schema',
  ],
  priority: 'P2',
  effort: 'L',
  nextStepSuggestions: [
    {
      tool: 'msgpack-decoder',
      reason: {
        en: 'Another compact binary format — MessagePack',
        vi: 'Một định dạng nhị phân gọn khác — MessagePack',
        es: 'Otro formato binario compacto — MessagePack',
        pt: 'Outro formato binário compacto — MessagePack',
      },
    },
    {
      tool: 'hex-encode',
      reason: {
        en: 'Turn raw bytes into hex to paste in here',
        vi: 'Chuyển byte thô thành hex để dán vào đây',
        es: 'Convierte bytes en hex para pegarlos aquí',
        pt: 'Converta bytes em hex para colar aqui',
      },
    },
  ],
};
