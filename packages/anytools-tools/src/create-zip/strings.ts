import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Create ZIP',
  filesLabel: 'Files to put in the archive',
  compressionLevel: 'Compression level',
  levelStore: 'store, no compression',
  folderLabel: 'Folder inside the zip (optional)',
  folderPlaceholder: 'e.g. invoices',
  zipping: 'Zipping…',
  createZip: 'Create .zip',
  createZipFrom: 'Create .zip from {n} files',
  buildFailed: 'Could not build the archive.',
  error_noFiles: 'Choose at least one file to zip.',
  // {size} / {max} formatted sizes
  error_tooLarge:
    "These files come to {size}, and a zip written here has to stay under {max}: the format's size fields are 32-bit and this writer does not emit the ZIP64 records that extend them. Past that point the archive would be silently corrupt, so it is refused instead. Zip them in two batches, or use a desktop archiver.",
  // {n} files, {in} / {out} formatted sizes
  summary: '{n} files · {in} in, {out} out',
  smaller: '{p}% smaller',
  downloadZip: 'Download .zip',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tạo file ZIP',
    filesLabel: 'Các tệp cần đưa vào file nén',
    compressionLevel: 'Mức nén',
    levelStore: 'chỉ lưu, không nén',
    folderLabel: 'Thư mục bên trong file zip (tuỳ chọn)',
    folderPlaceholder: 'vd. hoa-don',
    zipping: 'Đang nén…',
    createZip: 'Tạo .zip',
    createZipFrom: 'Tạo .zip từ {n} tệp',
    buildFailed: 'Không thể tạo file nén.',
    error_noFiles: 'Chọn ít nhất một tệp để nén.',
    error_tooLarge:
      'Các tệp này tổng cộng {size}, trong khi file zip tạo ở đây phải dưới {max}: các trường kích thước của định dạng là 32-bit và trình ghi này không xuất bản ghi ZIP64 để mở rộng chúng. Vượt ngưỡng đó file nén sẽ hỏng âm thầm, nên bị từ chối. Hãy nén thành hai đợt, hoặc dùng phần mềm nén trên máy tính.',
    summary: '{n} tệp · vào {in}, ra {out}',
    smaller: 'nhỏ hơn {p}%',
    downloadZip: 'Tải .zip',
  },
  es: {
    title: 'Crear ZIP',
    filesLabel: 'Archivos para incluir en el archivo comprimido',
    compressionLevel: 'Nivel de compresión',
    levelStore: 'almacenar, sin compresión',
    folderLabel: 'Carpeta dentro del zip (opcional)',
    folderPlaceholder: 'p. ej. facturas',
    zipping: 'Comprimiendo…',
    createZip: 'Crear .zip',
    createZipFrom: 'Crear .zip con {n} archivos',
    buildFailed: 'No se pudo crear el archivo comprimido.',
    error_noFiles: 'Elige al menos un archivo para comprimir.',
    error_tooLarge:
      'Estos archivos suman {size}, y un zip creado aquí debe quedar por debajo de {max}: los campos de tamaño del formato son de 32 bits y este generador no emite los registros ZIP64 que los amplían. Pasado ese punto el archivo quedaría corrupto sin aviso, así que se rechaza. Comprímelos en dos lotes o usa un compresor de escritorio.',
    summary: '{n} archivos · {in} de entrada, {out} de salida',
    smaller: '{p}% más pequeño',
    downloadZip: 'Descargar .zip',
  },
  pt: {
    title: 'Criar ZIP',
    filesLabel: 'Arquivos para colocar no pacote',
    compressionLevel: 'Nível de compressão',
    levelStore: 'armazenar, sem compressão',
    folderLabel: 'Pasta dentro do zip (opcional)',
    folderPlaceholder: 'ex.: faturas',
    zipping: 'Compactando…',
    createZip: 'Criar .zip',
    createZipFrom: 'Criar .zip com {n} arquivos',
    buildFailed: 'Não foi possível criar o pacote.',
    error_noFiles: 'Escolha pelo menos um arquivo para compactar.',
    error_tooLarge:
      'Estes arquivos somam {size}, e um zip criado aqui precisa ficar abaixo de {max}: os campos de tamanho do formato são de 32 bits e este gerador não grava os registros ZIP64 que os estendem. Além desse ponto o pacote ficaria corrompido em silêncio, então é recusado. Compacte em dois lotes ou use um compactador de desktop.',
    summary: '{n} arquivos · {in} de entrada, {out} de saída',
    smaller: '{p}% menor',
    downloadZip: 'Baixar .zip',
  },
};
