import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Merge PDF',
  dropLabel: 'PDFs to merge — drag to reorder, or use the arrows. They are combined top to bottom.',
  failed: 'Merge failed',
  merging: 'Merging…',
  mergeEmpty: 'Merge PDFs',
  mergeOne: 'Merge 1 PDF',
  mergeMany: 'Merge {n} PDFs',
  addMore: 'Add at least one more PDF to merge.',
  totalPages: '{n} pages',
  pageCountOne: '{n} page',
  pageCountMany: '{n} pages',
  download: 'Download merged.pdf',
  error_needTwoPdfs: 'Choose at least two PDFs to merge.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Ghép PDF',
    dropLabel:
      'Các PDF cần ghép — kéo để sắp xếp lại, hoặc dùng mũi tên. Ghép theo thứ tự từ trên xuống.',
    failed: 'Ghép thất bại',
    merging: 'Đang ghép…',
    mergeEmpty: 'Ghép PDF',
    mergeOne: 'Ghép 1 PDF',
    mergeMany: 'Ghép {n} PDF',
    addMore: 'Thêm ít nhất một PDF nữa để ghép.',
    totalPages: '{n} trang',
    pageCountOne: '{n} trang',
    pageCountMany: '{n} trang',
    download: 'Tải merged.pdf',
    error_needTwoPdfs: 'Chọn ít nhất hai PDF để ghép.',
  },
  es: {
    title: 'Unir PDF',
    dropLabel:
      'PDF a unir — arrastra para reordenar o usa las flechas. Se combinan de arriba abajo.',
    failed: 'La unión falló',
    merging: 'Uniendo…',
    mergeEmpty: 'Unir PDF',
    mergeOne: 'Unir 1 PDF',
    mergeMany: 'Unir {n} PDF',
    addMore: 'Añade al menos un PDF más para unir.',
    totalPages: '{n} páginas',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    download: 'Descargar merged.pdf',
    error_needTwoPdfs: 'Elige al menos dos PDF para unir.',
  },
  pt: {
    title: 'Juntar PDF',
    dropLabel:
      'PDFs a juntar — arraste para reordenar ou use as setas. São combinados de cima para baixo.',
    failed: 'A junção falhou',
    merging: 'Juntando…',
    mergeEmpty: 'Juntar PDFs',
    mergeOne: 'Juntar 1 PDF',
    mergeMany: 'Juntar {n} PDFs',
    addMore: 'Adicione pelo menos mais um PDF para juntar.',
    totalPages: '{n} páginas',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    download: 'Baixar merged.pdf',
    error_needTwoPdfs: 'Escolha pelo menos dois PDFs para juntar.',
  },
};
