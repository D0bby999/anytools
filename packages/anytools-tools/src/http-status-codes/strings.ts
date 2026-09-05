import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'HTTP Status Codes & MIME Types',
  statusTab: 'Status codes',
  mimeTab: 'MIME types',
  searchStatus: 'Search: 404, timeout, gateway…',
  searchStatusAria: 'Search status codes',
  noStatus: 'No matching status code.',
  searchMime: 'Search: .png, json, font…',
  searchMimeAria: 'Search MIME types',
  noMime: 'No matching MIME type.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Mã trạng thái HTTP & kiểu MIME',
    statusTab: 'Mã trạng thái',
    mimeTab: 'Kiểu MIME',
    searchStatus: 'Tìm: 404, timeout, gateway…',
    searchStatusAria: 'Tìm mã trạng thái',
    noStatus: 'Không có mã trạng thái phù hợp.',
    searchMime: 'Tìm: .png, json, font…',
    searchMimeAria: 'Tìm kiểu MIME',
    noMime: 'Không có kiểu MIME phù hợp.',
  },
  es: {
    title: 'Códigos de estado HTTP y tipos MIME',
    statusTab: 'Códigos de estado',
    mimeTab: 'Tipos MIME',
    searchStatus: 'Buscar: 404, timeout, gateway…',
    searchStatusAria: 'Buscar códigos de estado',
    noStatus: 'Ningún código de estado coincide.',
    searchMime: 'Buscar: .png, json, font…',
    searchMimeAria: 'Buscar tipos MIME',
    noMime: 'Ningún tipo MIME coincide.',
  },
  pt: {
    title: 'Códigos de status HTTP e tipos MIME',
    statusTab: 'Códigos de status',
    mimeTab: 'Tipos MIME',
    searchStatus: 'Buscar: 404, timeout, gateway…',
    searchStatusAria: 'Buscar códigos de status',
    noStatus: 'Nenhum código de status corresponde.',
    searchMime: 'Buscar: .png, json, font…',
    searchMimeAria: 'Buscar tipos MIME',
    noMime: 'Nenhum tipo MIME corresponde.',
  },
};
