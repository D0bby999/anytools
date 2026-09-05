import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Remove PDF Pages',
  dropLabel: 'PDF to edit',
  couldNotReadPdf: 'Could not read PDF',
  failed: 'Removal failed',
  pageCountOne: '{n} page',
  pageCountMany: '{n} pages',
  // {code} is replaced with the <code>1, 4-6, 12</code> example.
  pagesToDelete: 'Pages to delete — e.g. {code}',
  removing: 'Removing…',
  removePages: 'Remove pages',
  removedOne: 'Removed 1 page',
  removedMany: 'Removed {n} pages',
  leftOne: '1 page left.',
  leftMany: '{n} pages left.',
  download: 'Download {name}',
  error_removeAllPages:
    'That would remove every page. A PDF needs at least one page — keep one, or delete the file instead.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Xóa trang PDF',
    dropLabel: 'PDF cần chỉnh sửa',
    couldNotReadPdf: 'Không đọc được PDF',
    failed: 'Xóa trang thất bại',
    pageCountOne: '{n} trang',
    pageCountMany: '{n} trang',
    pagesToDelete: 'Các trang cần xóa — vd. {code}',
    removing: 'Đang xóa…',
    removePages: 'Xóa trang',
    removedOne: 'Đã xóa 1 trang',
    removedMany: 'Đã xóa {n} trang',
    leftOne: 'còn lại 1 trang.',
    leftMany: 'còn lại {n} trang.',
    download: 'Tải {name}',
    error_removeAllPages:
      'Làm vậy sẽ xóa hết mọi trang. PDF cần ít nhất một trang — hãy giữ lại một trang, hoặc xóa hẳn tệp.',
  },
  es: {
    title: 'Eliminar páginas de un PDF',
    dropLabel: 'PDF a editar',
    couldNotReadPdf: 'No se pudo leer el PDF',
    failed: 'La eliminación falló',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    pagesToDelete: 'Páginas a eliminar — p. ej. {code}',
    removing: 'Eliminando…',
    removePages: 'Eliminar páginas',
    removedOne: 'Eliminada 1 página',
    removedMany: 'Eliminadas {n} páginas',
    leftOne: 'queda 1 página.',
    leftMany: 'quedan {n} páginas.',
    download: 'Descargar {name}',
    error_removeAllPages:
      'Eso eliminaría todas las páginas. Un PDF necesita al menos una página — conserva una, o borra el archivo directamente.',
  },
  pt: {
    title: 'Remover páginas de PDF',
    dropLabel: 'PDF a editar',
    couldNotReadPdf: 'Não foi possível ler o PDF',
    failed: 'A remoção falhou',
    pageCountOne: '{n} página',
    pageCountMany: '{n} páginas',
    pagesToDelete: 'Páginas a excluir — ex. {code}',
    removing: 'Removendo…',
    removePages: 'Remover páginas',
    removedOne: 'Removida 1 página',
    removedMany: 'Removidas {n} páginas',
    leftOne: 'resta 1 página.',
    leftMany: 'restam {n} páginas.',
    download: 'Baixar {name}',
    error_removeAllPages:
      'Isso removeria todas as páginas. Um PDF precisa de pelo menos uma página — mantenha uma, ou apague o arquivo.',
  },
};
