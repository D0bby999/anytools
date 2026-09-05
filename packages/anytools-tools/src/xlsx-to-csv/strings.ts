import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'XLSX to CSV / JSON',
  workbookLabel: 'Excel workbook (.xlsx)',
  xlsxOnly: '.xlsx only.',
  // {xls} {ods} {csv} are file extensions in <code>, {saveAs} the menu path in <em>,
  // {link} the CSV ↔ JSON converter link.
  formatNote:
    'The old binary {xls}, OpenDocument {ods} and Apple Numbers files are different formats and will not open here — open one in Excel, LibreOffice or Numbers and use {saveAs} first. Plain {csv} files do not need this tool; the {link} takes those directly.',
  saveAs: 'Save As → .xlsx',
  csvJsonLink: 'CSV ↔ JSON converter',
  tooLarge:
    'This workbook is {size} MB, over the {max} MB limit. An .xlsx is compressed XML that expands several times over once parsed, so the tab would run out of memory before it finished. Split the workbook, or delete the sheets you do not need, and try again.',
  slow: "This workbook is over 20 MB. Parsing happens on this page's main thread, so the tab will stop responding for a while — possibly a long while. It will still be attempted.",
  reading: 'Reading…',
  readWorkbook: 'Read workbook',
  readFailed: 'Could not read this workbook',
  zipFailed: 'Could not build the zip',
  error_notXlsx:
    'This file could not be read as .xlsx. Old .xls, .ods and Numbers files are different formats — open one in Excel, LibreOffice or Numbers and save it as .xlsx first.',
  // {sheet} name; {columns} {rows} {cells} {max} are plain numbers.
  error_tooManyCells:
    'Sheet "{sheet}" covers {columns} columns by {rows} rows — {cells} cells, past the {max} this tool will build in a browser tab. A sheet is usually this wide by accident: one value or one leftover format far to the right of the data stretches it. Select the columns and rows beyond your data in Excel, delete them, save, and try again.',
  error_noSheets: 'This workbook has no sheets.',
  error_tooLarge:
    'This workbook is {size} MB. The limit is {max} MB, because an .xlsx is compressed XML that expands several times over in memory and the tab would run out before it finished. Split the workbook, or delete the sheets you do not need, and try again.',
  sheetLabel: 'Sheet ({n} in this workbook)',
  rowOne: '{n} row',
  rowMany: '{n} rows',
  delimiter: 'Delimiter',
  comma: 'Comma',
  semicolon: 'Semicolon',
  tab: 'Tab',
  quoteAll: 'Quote every field',
  bom: 'Add a UTF-8 BOM (Excel needs it to show accents correctly)',
  firstRowKeys: 'Use the first row as object keys',
  jsonNote:
    'Every value is a string — a spreadsheet cell has no JSON type. If you need real numbers and booleans, take the CSV into the {link}, which types values as it parses.',
  downloadSheet: 'Download this sheet',
  downloadAllSheets: 'Download all {n} sheets as .zip',
  previewAll: 'Preview. Copy and download always use the whole sheet.',
  previewFirst:
    'Preview — first {n} rows of {total}. Copy and download always use the whole sheet.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'XLSX sang CSV / JSON',
    workbookLabel: 'Bảng tính Excel (.xlsx)',
    xlsxOnly: 'Chỉ nhận .xlsx.',
    formatNote:
      'File nhị phân cũ {xls}, OpenDocument {ods} và file Apple Numbers là định dạng khác, sẽ không mở được ở đây — hãy mở bằng Excel, LibreOffice hoặc Numbers rồi {saveAs} trước. File {csv} thuần thì không cần công cụ này; {link} nhận trực tiếp.',
    saveAs: 'Lưu thành → .xlsx',
    csvJsonLink: 'bộ chuyển CSV ↔ JSON',
    tooLarge:
      'Bảng tính này nặng {size} MB, vượt giới hạn {max} MB. File .xlsx là XML nén, khi phân tích sẽ nở ra gấp nhiều lần nên tab sẽ hết bộ nhớ trước khi xong. Hãy tách bảng tính, hoặc xoá các sheet không cần, rồi thử lại.',
    slow: 'Bảng tính này lớn hơn 20 MB. Việc phân tích chạy trên luồng chính của trang, nên tab sẽ đứng một lúc — có thể khá lâu. Vẫn sẽ thử xử lý.',
    reading: 'Đang đọc…',
    readWorkbook: 'Đọc bảng tính',
    readFailed: 'Không đọc được bảng tính này',
    zipFailed: 'Không tạo được file zip',
    error_notXlsx:
      'Không đọc được tệp này dưới dạng .xlsx. Các tệp .xls cũ, .ods và Numbers là định dạng khác — hãy mở trong Excel, LibreOffice hoặc Numbers rồi lưu thành .xlsx trước.',
    error_tooManyCells:
      'Sheet "{sheet}" trải rộng {columns} cột × {rows} hàng — {cells} ô, vượt mức {max} mà công cụ này dựng được trong tab trình duyệt. Sheet thường rộng như vậy do vô ý: một giá trị hay một định dạng còn sót ở tít bên phải dữ liệu kéo nó ra. Hãy chọn các cột và hàng ngoài vùng dữ liệu trong Excel, xoá đi, lưu rồi thử lại.',
    error_noSheets: 'Bảng tính này không có sheet nào.',
    error_tooLarge:
      'Bảng tính này nặng {size} MB. Giới hạn là {max} MB, vì file .xlsx là XML nén, khi phân tích sẽ nở ra gấp nhiều lần trong bộ nhớ nên tab sẽ hết bộ nhớ trước khi xong. Hãy tách bảng tính, hoặc xoá các sheet không cần, rồi thử lại.',
    sheetLabel: 'Sheet ({n} sheet trong bảng tính)',
    rowOne: '{n} dòng',
    rowMany: '{n} dòng',
    delimiter: 'Dấu phân cách',
    comma: 'Dấu phẩy',
    semicolon: 'Dấu chấm phẩy',
    tab: 'Tab',
    quoteAll: 'Đặt mọi ô trong dấu ngoặc kép',
    bom: 'Thêm BOM UTF-8 (Excel cần để hiện đúng dấu tiếng Việt)',
    firstRowKeys: 'Dùng dòng đầu làm khoá của object',
    jsonNote:
      'Mọi giá trị đều là chuỗi — ô bảng tính không có kiểu JSON. Nếu cần số và boolean thật, đưa CSV qua {link}, công cụ đó sẽ gán kiểu khi phân tích.',
    downloadSheet: 'Tải sheet này',
    downloadAllSheets: 'Tải cả {n} sheet dạng .zip',
    previewAll: 'Xem trước. Sao chép và tải xuống luôn dùng toàn bộ sheet.',
    previewFirst:
      'Xem trước — {n} dòng đầu trong {total}. Sao chép và tải xuống luôn dùng toàn bộ sheet.',
  },
  es: {
    title: 'XLSX a CSV / JSON',
    workbookLabel: 'Libro de Excel (.xlsx)',
    xlsxOnly: 'Solo .xlsx.',
    formatNote:
      'El antiguo binario {xls}, OpenDocument {ods} y los archivos de Apple Numbers son formatos distintos y no se abrirán aquí — ábrelos en Excel, LibreOffice o Numbers y usa {saveAs} primero. Los archivos {csv} simples no necesitan esta herramienta; el {link} los acepta directamente.',
    saveAs: 'Guardar como → .xlsx',
    csvJsonLink: 'conversor CSV ↔ JSON',
    tooLarge:
      'Este libro pesa {size} MB, por encima del límite de {max} MB. Un .xlsx es XML comprimido que se expande varias veces al analizarlo, así que la pestaña se quedaría sin memoria antes de terminar. Divide el libro, o elimina las hojas que no necesites, e inténtalo de nuevo.',
    slow: 'Este libro supera los 20 MB. El análisis se ejecuta en el hilo principal de la página, así que la pestaña dejará de responder un rato — quizá bastante. Se intentará de todos modos.',
    reading: 'Leyendo…',
    readWorkbook: 'Leer libro',
    readFailed: 'No se pudo leer este libro',
    zipFailed: 'No se pudo crear el zip',
    error_notXlsx:
      'Este archivo no se pudo leer como .xlsx. Los antiguos .xls, .ods y los archivos de Numbers son formatos distintos — ábrelo en Excel, LibreOffice o Numbers y guárdalo como .xlsx primero.',
    error_tooManyCells:
      'La hoja "{sheet}" abarca {columns} columnas por {rows} filas — {cells} celdas, más de las {max} que esta herramienta construye en una pestaña del navegador. Una hoja suele ser así de ancha por accidente: un valor o un formato olvidado muy a la derecha de los datos la estira. Selecciona en Excel las columnas y filas más allá de tus datos, elimínalas, guarda e inténtalo de nuevo.',
    error_noSheets: 'Este libro no tiene hojas.',
    error_tooLarge:
      'Este libro pesa {size} MB. El límite es {max} MB, porque un .xlsx es XML comprimido que se expande varias veces en memoria y la pestaña se quedaría sin ella antes de terminar. Divide el libro, o elimina las hojas que no necesites, e inténtalo de nuevo.',
    sheetLabel: 'Hoja ({n} en este libro)',
    rowOne: '{n} fila',
    rowMany: '{n} filas',
    delimiter: 'Delimitador',
    comma: 'Coma',
    semicolon: 'Punto y coma',
    tab: 'Tabulador',
    quoteAll: 'Entrecomillar todos los campos',
    bom: 'Añadir BOM UTF-8 (Excel lo necesita para mostrar bien los acentos)',
    firstRowKeys: 'Usar la primera fila como claves del objeto',
    jsonNote:
      'Cada valor es una cadena — una celda de hoja de cálculo no tiene tipo JSON. Si necesitas números y booleanos reales, lleva el CSV al {link}, que tipa los valores al analizarlos.',
    downloadSheet: 'Descargar esta hoja',
    downloadAllSheets: 'Descargar las {n} hojas como .zip',
    previewAll: 'Vista previa. Copiar y descargar siempre usan la hoja completa.',
    previewFirst:
      'Vista previa — primeras {n} filas de {total}. Copiar y descargar siempre usan la hoja completa.',
  },
  pt: {
    title: 'XLSX para CSV / JSON',
    workbookLabel: 'Pasta de trabalho do Excel (.xlsx)',
    xlsxOnly: 'Somente .xlsx.',
    formatNote:
      'O antigo binário {xls}, o OpenDocument {ods} e os arquivos do Apple Numbers são formatos diferentes e não abrem aqui — abra no Excel, LibreOffice ou Numbers e use {saveAs} primeiro. Arquivos {csv} simples não precisam desta ferramenta; o {link} aceita esses diretamente.',
    saveAs: 'Salvar como → .xlsx',
    csvJsonLink: 'conversor CSV ↔ JSON',
    tooLarge:
      'Esta pasta de trabalho tem {size} MB, acima do limite de {max} MB. Um .xlsx é XML compactado que se expande várias vezes ao ser analisado, então a aba ficaria sem memória antes de terminar. Divida a pasta de trabalho, ou exclua as planilhas de que não precisa, e tente novamente.',
    slow: 'Esta pasta de trabalho passa de 20 MB. A análise roda na thread principal da página, então a aba vai parar de responder por um tempo — talvez longo. Ainda assim será tentado.',
    reading: 'Lendo…',
    readWorkbook: 'Ler pasta de trabalho',
    readFailed: 'Não foi possível ler esta pasta de trabalho',
    zipFailed: 'Não foi possível criar o zip',
    error_notXlsx:
      'Este arquivo não pôde ser lido como .xlsx. Os antigos .xls, .ods e arquivos do Numbers são formatos diferentes — abra-o no Excel, LibreOffice ou Numbers e salve como .xlsx primeiro.',
    error_tooManyCells:
      'A planilha "{sheet}" cobre {columns} colunas por {rows} linhas — {cells} células, além das {max} que esta ferramenta constrói em uma aba do navegador. Uma planilha costuma ficar assim larga por acidente: um valor ou um formato esquecido bem à direita dos dados a estica. Selecione no Excel as colunas e linhas além dos seus dados, exclua-as, salve e tente novamente.',
    error_noSheets: 'Esta pasta de trabalho não tem planilhas.',
    error_tooLarge:
      'Esta pasta de trabalho tem {size} MB. O limite é {max} MB, porque um .xlsx é XML compactado que se expande várias vezes na memória e a aba ficaria sem memória antes de terminar. Divida a pasta de trabalho, ou exclua as planilhas de que não precisa, e tente novamente.',
    sheetLabel: 'Planilha ({n} nesta pasta de trabalho)',
    rowOne: '{n} linha',
    rowMany: '{n} linhas',
    delimiter: 'Delimitador',
    comma: 'Vírgula',
    semicolon: 'Ponto e vírgula',
    tab: 'Tabulação',
    quoteAll: 'Colocar todos os campos entre aspas',
    bom: 'Adicionar BOM UTF-8 (o Excel precisa dele para mostrar acentos corretamente)',
    firstRowKeys: 'Usar a primeira linha como chaves do objeto',
    jsonNote:
      'Todo valor é uma string — uma célula de planilha não tem tipo JSON. Se precisar de números e booleanos de verdade, leve o CSV ao {link}, que tipa os valores ao analisar.',
    downloadSheet: 'Baixar esta planilha',
    downloadAllSheets: 'Baixar todas as {n} planilhas como .zip',
    previewAll: 'Pré-visualização. Copiar e baixar sempre usam a planilha inteira.',
    previewFirst:
      'Pré-visualização — primeiras {n} linhas de {total}. Copiar e baixar sempre usam a planilha inteira.',
  },
};
