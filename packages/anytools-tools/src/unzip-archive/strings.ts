import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Unzip Archive',
  archiveLabel: 'Archive to open (.zip .7z .rar .tar .tar.gz)',
  passwordLabel: 'Password (only if the archive has one)',
  passwordPlaceholder: 'leave empty for a normal archive',
  working: 'Working…',
  openArchive: 'Open archive',
  readFailed: 'This archive could not be read.',
  extractFailed: 'Could not extract {path}.',
  repackFailed: 'Could not repack the archive.',
  // Errors raised by logic; {count} {max} {index} {total} {files} {distinct} are numbers,
  // {limit} a formatted size, {name} {path} entry names, {detail} the engine's own wording.
  error_notArchive:
    '"{name}" does not look like a zip, 7z, rar, tar or gzip archive — its first bytes match none of them.',
  error_zipEncrypted: 'This zip is encrypted. Enter its password and open it again.',
  error_tooManyEntries:
    'This archive declares {count} entries; the limit is {max}. It is refused rather than opened — an archive that shape is usually a zip bomb.',
  error_unknownEntrySize:
    'Entry {index} of {total} does not state a size this reader can make sense of, so there is no way to know what opening it would cost. It is refused rather than opened.',
  error_declaredTooBig:
    'This archive unpacks to more than 2 GB (past the limit at entry {index} of {total}). It is refused rather than opened — extracting it would run this tab out of memory.',
  error_budgetExceeded:
    'Extraction stopped: this archive has already produced more than {limit}, whatever its directory claimed. A file that decompresses far past its declared size is the definition of a zip bomb.',
  error_zip64SizeUnknown:
    '"{name}" declares a ZIP64 size that this reader cannot read back, so its real size is unknown. The archive is refused rather than opened — an entry of unknown size is how a zip bomb gets past a size limit.',
  error_pathsCollapsed:
    'This archive holds {files} files but only {distinct} of them have distinct paths: at least one entry uses "../" or "./" to land on the same path as another, and the zip reader here keeps only the last. It is refused rather than opened one file short — a desktop archiver will show you what is really inside.',
  error_untrustedSize:
    '"{path}" does not state a size this reader can trust. The archive is refused rather than opened.',
  error_extractFailed: '{detail}',
  error_notInArchive: '"{path}" is not in this archive.',
  error_openTimeout:
    'Opening the archive did not finish within {seconds} seconds. The archive engine may have failed to start — that is a bug on our side, not a problem with your file.',
  error_listTimeout:
    'Reading the file list did not finish within {seconds} seconds. The archive engine may have failed to start — that is a bug on our side, not a problem with your file.',
  error_wrongPassword:
    'That password did not open the archive. Check it and try again — for RAR files, note that a file list can be readable while the contents are not.',
  error_encrypted: 'This archive is encrypted. Enter its password and open it again.',
  error_unsupportedVariant:
    'This archive could not be read: {detail}. Some variants (solid RAR5 with encrypted headers, for example) are outside what the reader supports.',
  error_unreadable: 'This archive could not be read: {detail}',
  extracting: 'Extracting {done} of {total}…',
  // {kind} archive type, {n} entries, {size} formatted bytes, {engine} reader name
  summary: '{kind} · {n} files · {size} uncompressed · read with {engine}',
  extractAll: 'Extract all to a .zip',
  downloadZip: 'Download .zip',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Giải nén file',
    archiveLabel: 'File nén cần mở (.zip .7z .rar .tar .tar.gz)',
    passwordLabel: 'Mật khẩu (chỉ khi file nén có đặt)',
    passwordPlaceholder: 'để trống với file nén thông thường',
    working: 'Đang xử lý…',
    openArchive: 'Mở file nén',
    readFailed: 'Không đọc được file nén này.',
    extractFailed: 'Không giải nén được {path}.',
    repackFailed: 'Không đóng gói lại được file nén.',
    error_notArchive:
      '"{name}" không giống file zip, 7z, rar, tar hay gzip — những byte đầu không khớp định dạng nào.',
    error_zipEncrypted: 'File zip này được mã hoá. Nhập mật khẩu rồi mở lại.',
    error_tooManyEntries:
      'File nén này khai báo {count} mục; giới hạn là {max}. Bị từ chối thay vì mở — file nén dạng này thường là zip bomb.',
    error_unknownEntrySize:
      'Mục {index} trong {total} không khai báo kích thước mà trình đọc này hiểu được, nên không thể biết mở nó tốn bao nhiêu. Bị từ chối thay vì mở.',
    error_declaredTooBig:
      'File nén này giải nén ra hơn 2 GB (vượt giới hạn tại mục {index} trong {total}). Bị từ chối thay vì mở — giải nén sẽ làm tab hết bộ nhớ.',
    error_budgetExceeded:
      'Đã dừng giải nén: file nén này đã tạo ra hơn {limit}, bất kể thư mục của nó khai báo gì. Một tệp giải nén vượt xa kích thước khai báo chính là định nghĩa của zip bomb.',
    error_zip64SizeUnknown:
      '"{name}" khai báo kích thước ZIP64 mà trình đọc này không đọc lại được, nên kích thước thật không rõ. File nén bị từ chối thay vì mở — một mục không rõ kích thước là cách zip bomb lách qua giới hạn.',
    error_pathsCollapsed:
      'File nén này chứa {files} tệp nhưng chỉ {distinct} tệp có đường dẫn khác nhau: ít nhất một mục dùng "../" hoặc "./" để trùng đường dẫn với mục khác, và trình đọc zip ở đây chỉ giữ mục cuối. Bị từ chối thay vì mở thiếu một tệp — phần mềm nén trên máy tính sẽ cho bạn thấy bên trong thực sự có gì.',
    error_untrustedSize:
      '"{path}" không khai báo kích thước đáng tin. File nén bị từ chối thay vì mở.',
    error_extractFailed: 'Giải nén thất bại: {detail}',
    error_notInArchive: '"{path}" không có trong file nén này.',
    error_openTimeout:
      'Mở file nén không xong trong {seconds} giây. Có thể engine giải nén không khởi động được — đó là lỗi phía chúng tôi, không phải do tệp của bạn.',
    error_listTimeout:
      'Đọc danh sách tệp không xong trong {seconds} giây. Có thể engine giải nén không khởi động được — đó là lỗi phía chúng tôi, không phải do tệp của bạn.',
    error_wrongPassword:
      'Mật khẩu đó không mở được file nén. Kiểm tra lại rồi thử lại — với file RAR, lưu ý danh sách tệp có thể đọc được trong khi nội dung thì không.',
    error_encrypted: 'File nén này được mã hoá. Nhập mật khẩu rồi mở lại.',
    error_unsupportedVariant:
      'Không đọc được file nén này: {detail}. Một số biến thể (ví dụ RAR5 solid với header mã hoá) nằm ngoài khả năng của trình đọc.',
    error_unreadable: 'Không đọc được file nén này: {detail}',
    extracting: 'Đang giải nén {done}/{total}…',
    summary: '{kind} · {n} tệp · {size} sau giải nén · đọc bằng {engine}',
    extractAll: 'Giải nén tất cả ra .zip',
    downloadZip: 'Tải .zip',
  },
  es: {
    title: 'Descomprimir archivo',
    archiveLabel: 'Archivo comprimido a abrir (.zip .7z .rar .tar .tar.gz)',
    passwordLabel: 'Contraseña (solo si el archivo la tiene)',
    passwordPlaceholder: 'déjalo vacío para un archivo normal',
    working: 'Trabajando…',
    openArchive: 'Abrir archivo',
    readFailed: 'No se pudo leer este archivo comprimido.',
    extractFailed: 'No se pudo extraer {path}.',
    repackFailed: 'No se pudo volver a empaquetar el archivo.',
    error_notArchive:
      '"{name}" no parece un archivo zip, 7z, rar, tar ni gzip — sus primeros bytes no coinciden con ninguno.',
    error_zipEncrypted: 'Este zip está cifrado. Introduce su contraseña y ábrelo de nuevo.',
    error_tooManyEntries:
      'Este archivo declara {count} entradas; el límite es {max}. Se rechaza en lugar de abrirse — un archivo con esa forma suele ser una zip bomb.',
    error_unknownEntrySize:
      'La entrada {index} de {total} no declara un tamaño que este lector pueda interpretar, así que no hay forma de saber cuánto costaría abrirla. Se rechaza en lugar de abrirse.',
    error_declaredTooBig:
      'Este archivo se descomprime a más de 2 GB (supera el límite en la entrada {index} de {total}). Se rechaza en lugar de abrirse — extraerlo agotaría la memoria de esta pestaña.',
    error_budgetExceeded:
      'Extracción detenida: este archivo ya ha producido más de {limit}, diga lo que diga su directorio. Un archivo que se descomprime mucho más allá de su tamaño declarado es la definición de una zip bomb.',
    error_zip64SizeUnknown:
      '"{name}" declara un tamaño ZIP64 que este lector no puede leer, así que su tamaño real es desconocido. El archivo se rechaza en lugar de abrirse — una entrada de tamaño desconocido es como una zip bomb burla un límite de tamaño.',
    error_pathsCollapsed:
      'Este archivo contiene {files} archivos pero solo {distinct} tienen rutas distintas: al menos una entrada usa "../" o "./" para caer en la misma ruta que otra, y el lector zip de aquí solo conserva la última. Se rechaza en lugar de abrirse con un archivo de menos — un compresor de escritorio te mostrará qué hay realmente dentro.',
    error_untrustedSize:
      '"{path}" no declara un tamaño en el que este lector pueda confiar. El archivo se rechaza en lugar de abrirse.',
    error_extractFailed: 'La extracción falló: {detail}',
    error_notInArchive: '"{path}" no está en este archivo.',
    error_openTimeout:
      'Abrir el archivo no terminó en {seconds} segundos. Puede que el motor de archivos no haya arrancado — es un error nuestro, no un problema de tu archivo.',
    error_listTimeout:
      'Leer la lista de archivos no terminó en {seconds} segundos. Puede que el motor de archivos no haya arrancado — es un error nuestro, no un problema de tu archivo.',
    error_wrongPassword:
      'Esa contraseña no abrió el archivo. Revísala e inténtalo de nuevo — en los RAR, ten en cuenta que la lista de archivos puede leerse aunque el contenido no.',
    error_encrypted: 'Este archivo está cifrado. Introduce su contraseña y ábrelo de nuevo.',
    error_unsupportedVariant:
      'Este archivo no se pudo leer: {detail}. Algunas variantes (RAR5 sólido con cabeceras cifradas, por ejemplo) quedan fuera de lo que admite el lector.',
    error_unreadable: 'Este archivo no se pudo leer: {detail}',
    extracting: 'Extrayendo {done} de {total}…',
    summary: '{kind} · {n} archivos · {size} sin comprimir · leído con {engine}',
    extractAll: 'Extraer todo a un .zip',
    downloadZip: 'Descargar .zip',
  },
  pt: {
    title: 'Descompactar arquivo',
    archiveLabel: 'Pacote a abrir (.zip .7z .rar .tar .tar.gz)',
    passwordLabel: 'Senha (somente se o pacote tiver uma)',
    passwordPlaceholder: 'deixe em branco para um pacote comum',
    working: 'Trabalhando…',
    openArchive: 'Abrir pacote',
    readFailed: 'Não foi possível ler este pacote.',
    extractFailed: 'Não foi possível extrair {path}.',
    repackFailed: 'Não foi possível reempacotar o arquivo.',
    error_notArchive:
      '"{name}" não parece um arquivo zip, 7z, rar, tar ou gzip — seus primeiros bytes não correspondem a nenhum deles.',
    error_zipEncrypted: 'Este zip está criptografado. Digite a senha e abra-o novamente.',
    error_tooManyEntries:
      'Este arquivo declara {count} entradas; o limite é {max}. É recusado em vez de aberto — um arquivo com essa forma costuma ser uma zip bomb.',
    error_unknownEntrySize:
      'A entrada {index} de {total} não declara um tamanho que este leitor consiga interpretar, então não há como saber quanto custaria abri-la. É recusado em vez de aberto.',
    error_declaredTooBig:
      'Este arquivo descompacta para mais de 2 GB (passa do limite na entrada {index} de {total}). É recusado em vez de aberto — extraí-lo esgotaria a memória desta aba.',
    error_budgetExceeded:
      'Extração interrompida: este arquivo já produziu mais de {limit}, diga o que disser seu diretório. Um arquivo que descompacta muito além do tamanho declarado é a definição de uma zip bomb.',
    error_zip64SizeUnknown:
      '"{name}" declara um tamanho ZIP64 que este leitor não consegue ler de volta, então seu tamanho real é desconhecido. O arquivo é recusado em vez de aberto — uma entrada de tamanho desconhecido é como uma zip bomb passa por um limite de tamanho.',
    error_pathsCollapsed:
      'Este arquivo contém {files} arquivos, mas só {distinct} deles têm caminhos distintos: pelo menos uma entrada usa "../" ou "./" para cair no mesmo caminho de outra, e o leitor de zip daqui mantém apenas a última. É recusado em vez de aberto com um arquivo a menos — um compactador de desktop mostrará o que realmente há dentro.',
    error_untrustedSize:
      '"{path}" não declara um tamanho em que este leitor possa confiar. O arquivo é recusado em vez de aberto.',
    error_extractFailed: 'A extração falhou: {detail}',
    error_notInArchive: '"{path}" não está neste arquivo.',
    error_openTimeout:
      'Abrir o arquivo não terminou em {seconds} segundos. O motor de arquivos pode não ter iniciado — isso é um bug nosso, não um problema com o seu arquivo.',
    error_listTimeout:
      'Ler a lista de arquivos não terminou em {seconds} segundos. O motor de arquivos pode não ter iniciado — isso é um bug nosso, não um problema com o seu arquivo.',
    error_wrongPassword:
      'Essa senha não abriu o arquivo. Confira e tente novamente — em arquivos RAR, note que a lista de arquivos pode ser legível enquanto o conteúdo não é.',
    error_encrypted: 'Este arquivo está criptografado. Digite a senha e abra-o novamente.',
    error_unsupportedVariant:
      'Este arquivo não pôde ser lido: {detail}. Algumas variantes (RAR5 sólido com cabeçalhos criptografados, por exemplo) estão fora do que o leitor suporta.',
    error_unreadable: 'Este arquivo não pôde ser lido: {detail}',
    extracting: 'Extraindo {done} de {total}…',
    summary: '{kind} · {n} arquivos · {size} descompactados · lido com {engine}',
    extractAll: 'Extrair tudo para um .zip',
    downloadZip: 'Baixar .zip',
  },
};
