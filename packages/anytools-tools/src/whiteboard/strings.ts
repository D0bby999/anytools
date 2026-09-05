import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Online whiteboard',
  staleCopy: 'The copy in this browser is an earlier version of it.',
  nothingSaved: 'Nothing is saved in this browser yet.',
  overLimit:
    'This board is past the {mb} MB browser-storage limit, so it is no longer being saved. {note} Export it as .excalidraw to keep this version.',
  savedInBrowser: 'Saved in this browser',
  couldNotSave:
    'Could not save the board — browser storage is full or blocked. {note} Export it as .excalidraw to keep this version.',
  newBoard: 'New board',
  boardEmpty: 'The board is empty — draw something first.',
  couldNotExport: 'Could not export the board.',
  fileTooBig: 'That file is {size} MB. The limit is {limit} MB.',
  opened: 'Opened {name}',
  openedRemovedOne: 'Opened {name} — removed 1 embedded frame, which this board does not load.',
  openedRemovedMany: 'Opened {name} — removed {n} embedded frames, which this board does not load.',
  couldNotOpen: 'Could not open that file.',
  eraseQuestion: 'Erase this board?',
  yesErase: 'Yes, erase it',
  exportPng: 'Export PNG',
  exportSvg: 'Export SVG',
  exportExcalidraw: 'Export .excalidraw',
  replaceQuestion: 'Replace this board with a file?',
  yesChooseFile: 'Yes, choose a file',
  openExcalidraw: 'Open .excalidraw',
  chooseFileAria: 'Choose an .excalidraw file to open',
  downloadFile: 'Download {name}',
  loadingBoard: 'Loading the board…',
  savedOnlyHere: 'Saved in this browser only',
  autosaveNote:
    'The board autosaves to this browser’s storage about half a second after you stop drawing. Clearing site data erases it. Export a {code} file to keep a copy you can reopen here or on excalidraw.com.',
  error_sceneTooBig: 'That scene is {mb} MB. The limit is {cap} MB — it is too big to open here.',
  error_fileEmpty: 'That file is empty.',
  error_notJson: 'That file is not valid JSON, so it is not an .excalidraw scene.',
  error_notSceneObject: 'That file does not contain an .excalidraw scene object.',
  error_shapeLibrary:
    'That is an Excalidraw shape library (.excalidrawlib), not a drawing. Open it from the library panel instead.',
  error_wrongType:
    'Not an Excalidraw scene: its "type" field says "{type}", expected "excalidraw".',
  error_missingType:
    'Not an Excalidraw scene: its "type" field says nothing, expected "excalidraw".',
  error_noVersion: 'That scene has no version number, so it cannot be read safely.',
  error_newerVersion:
    'That scene is version {version}; this tool reads up to version {max}. It was saved by a newer Excalidraw.',
  error_noElements: 'That scene has no "elements" array — nothing to draw.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Bảng trắng trực tuyến',
    staleCopy: 'Bản sao trong trình duyệt này là phiên bản cũ hơn.',
    nothingSaved: 'Chưa có gì được lưu trong trình duyệt này.',
    overLimit:
      'Bảng này đã vượt giới hạn lưu trữ {mb} MB của trình duyệt nên không còn được lưu nữa. {note} Hãy xuất ra .excalidraw để giữ phiên bản này.',
    savedInBrowser: 'Đã lưu trong trình duyệt này',
    couldNotSave:
      'Không lưu được bảng — bộ nhớ trình duyệt đã đầy hoặc bị chặn. {note} Hãy xuất ra .excalidraw để giữ phiên bản này.',
    newBoard: 'Bảng mới',
    boardEmpty: 'Bảng đang trống — hãy vẽ gì đó trước.',
    couldNotExport: 'Không xuất được bảng.',
    fileTooBig: 'Tệp đó nặng {size} MB. Giới hạn là {limit} MB.',
    opened: 'Đã mở {name}',
    openedRemovedOne: 'Đã mở {name} — đã gỡ 1 khung nhúng vì bảng này không tải khung nhúng.',
    openedRemovedMany: 'Đã mở {name} — đã gỡ {n} khung nhúng vì bảng này không tải khung nhúng.',
    couldNotOpen: 'Không mở được tệp đó.',
    eraseQuestion: 'Xóa bảng này?',
    yesErase: 'Có, xóa đi',
    exportPng: 'Xuất PNG',
    exportSvg: 'Xuất SVG',
    exportExcalidraw: 'Xuất .excalidraw',
    replaceQuestion: 'Thay bảng này bằng một tệp?',
    yesChooseFile: 'Có, chọn tệp',
    openExcalidraw: 'Mở .excalidraw',
    chooseFileAria: 'Chọn tệp .excalidraw để mở',
    downloadFile: 'Tải xuống {name}',
    loadingBoard: 'Đang tải bảng…',
    savedOnlyHere: 'Chỉ lưu trong trình duyệt này',
    autosaveNote:
      'Bảng tự động lưu vào bộ nhớ trình duyệt khoảng nửa giây sau khi bạn ngừng vẽ. Xóa dữ liệu trang web sẽ xóa luôn bảng. Hãy xuất tệp {code} để giữ bản sao có thể mở lại ở đây hoặc trên excalidraw.com.',
    error_sceneTooBig: 'Bản vẽ này nặng {mb} MB. Giới hạn là {cap} MB — quá lớn để mở ở đây.',
    error_fileEmpty: 'Tệp đó trống.',
    error_notJson: 'Tệp đó không phải JSON hợp lệ nên không phải bản vẽ .excalidraw.',
    error_notSceneObject: 'Tệp đó không chứa đối tượng bản vẽ .excalidraw.',
    error_shapeLibrary:
      'Đó là thư viện hình của Excalidraw (.excalidrawlib), không phải bản vẽ. Hãy mở nó từ bảng thư viện.',
    error_wrongType:
      'Không phải bản vẽ Excalidraw: trường "type" ghi "{type}", cần là "excalidraw".',
    error_missingType:
      'Không phải bản vẽ Excalidraw: trường "type" không có giá trị, cần là "excalidraw".',
    error_noVersion: 'Bản vẽ này không có số phiên bản nên không thể đọc an toàn.',
    error_newerVersion:
      'Bản vẽ này là phiên bản {version}; công cụ này chỉ đọc tới phiên bản {max}. Nó được lưu bởi một Excalidraw mới hơn.',
    error_noElements: 'Bản vẽ này không có mảng "elements" — không có gì để vẽ.',
  },
  es: {
    title: 'Pizarra en línea',
    staleCopy: 'La copia en este navegador es una versión anterior.',
    nothingSaved: 'Todavía no hay nada guardado en este navegador.',
    overLimit:
      'Esta pizarra supera el límite de {mb} MB de almacenamiento del navegador, así que ya no se guarda. {note} Expórtala como .excalidraw para conservar esta versión.',
    savedInBrowser: 'Guardado en este navegador',
    couldNotSave:
      'No se pudo guardar la pizarra: el almacenamiento del navegador está lleno o bloqueado. {note} Expórtala como .excalidraw para conservar esta versión.',
    newBoard: 'Nueva pizarra',
    boardEmpty: 'La pizarra está vacía: dibuja algo primero.',
    couldNotExport: 'No se pudo exportar la pizarra.',
    fileTooBig: 'Ese archivo pesa {size} MB. El límite es {limit} MB.',
    opened: 'Se abrió {name}',
    openedRemovedOne: 'Se abrió {name}: se quitó 1 marco incrustado, que esta pizarra no carga.',
    openedRemovedMany:
      'Se abrió {name}: se quitaron {n} marcos incrustados, que esta pizarra no carga.',
    couldNotOpen: 'No se pudo abrir ese archivo.',
    eraseQuestion: '¿Borrar esta pizarra?',
    yesErase: 'Sí, borrarla',
    exportPng: 'Exportar PNG',
    exportSvg: 'Exportar SVG',
    exportExcalidraw: 'Exportar .excalidraw',
    replaceQuestion: '¿Reemplazar esta pizarra con un archivo?',
    yesChooseFile: 'Sí, elegir un archivo',
    openExcalidraw: 'Abrir .excalidraw',
    chooseFileAria: 'Elige un archivo .excalidraw para abrir',
    downloadFile: 'Descargar {name}',
    loadingBoard: 'Cargando la pizarra…',
    savedOnlyHere: 'Guardado solo en este navegador',
    autosaveNote:
      'La pizarra se guarda automáticamente en el almacenamiento de este navegador medio segundo después de dejar de dibujar. Borrar los datos del sitio la elimina. Exporta un archivo {code} para conservar una copia que puedas reabrir aquí o en excalidraw.com.',
    error_sceneTooBig:
      'Esa escena pesa {mb} MB. El límite es {cap} MB: es demasiado grande para abrirla aquí.',
    error_fileEmpty: 'Ese archivo está vacío.',
    error_notJson: 'Ese archivo no es JSON válido, así que no es una escena .excalidraw.',
    error_notSceneObject: 'Ese archivo no contiene un objeto de escena .excalidraw.',
    error_shapeLibrary:
      'Eso es una biblioteca de formas de Excalidraw (.excalidrawlib), no un dibujo. Ábrela desde el panel de biblioteca.',
    error_wrongType:
      'No es una escena de Excalidraw: su campo "type" dice "{type}", se esperaba "excalidraw".',
    error_missingType:
      'No es una escena de Excalidraw: su campo "type" no dice nada, se esperaba "excalidraw".',
    error_noVersion:
      'Esa escena no tiene número de versión, así que no se puede leer con seguridad.',
    error_newerVersion:
      'Esa escena es la versión {version}; esta herramienta lee hasta la versión {max}. La guardó un Excalidraw más nuevo.',
    error_noElements: 'Esa escena no tiene un arreglo "elements": no hay nada que dibujar.',
  },
  pt: {
    title: 'Quadro branco online',
    staleCopy: 'A cópia neste navegador é uma versão anterior.',
    nothingSaved: 'Ainda não há nada salvo neste navegador.',
    overLimit:
      'Este quadro passou do limite de {mb} MB de armazenamento do navegador, então não está mais sendo salvo. {note} Exporte como .excalidraw para manter esta versão.',
    savedInBrowser: 'Salvo neste navegador',
    couldNotSave:
      'Não foi possível salvar o quadro: o armazenamento do navegador está cheio ou bloqueado. {note} Exporte como .excalidraw para manter esta versão.',
    newBoard: 'Novo quadro',
    boardEmpty: 'O quadro está vazio: desenhe algo primeiro.',
    couldNotExport: 'Não foi possível exportar o quadro.',
    fileTooBig: 'Esse arquivo tem {size} MB. O limite é {limit} MB.',
    opened: '{name} aberto',
    openedRemovedOne:
      '{name} aberto: 1 quadro incorporado foi removido, pois este quadro não o carrega.',
    openedRemovedMany:
      '{name} aberto: {n} quadros incorporados foram removidos, pois este quadro não os carrega.',
    couldNotOpen: 'Não foi possível abrir esse arquivo.',
    eraseQuestion: 'Apagar este quadro?',
    yesErase: 'Sim, apagar',
    exportPng: 'Exportar PNG',
    exportSvg: 'Exportar SVG',
    exportExcalidraw: 'Exportar .excalidraw',
    replaceQuestion: 'Substituir este quadro por um arquivo?',
    yesChooseFile: 'Sim, escolher um arquivo',
    openExcalidraw: 'Abrir .excalidraw',
    chooseFileAria: 'Escolha um arquivo .excalidraw para abrir',
    downloadFile: 'Baixar {name}',
    loadingBoard: 'Carregando o quadro…',
    savedOnlyHere: 'Salvo apenas neste navegador',
    autosaveNote:
      'O quadro é salvo automaticamente no armazenamento deste navegador cerca de meio segundo depois que você para de desenhar. Limpar os dados do site o apaga. Exporte um arquivo {code} para manter uma cópia que você pode reabrir aqui ou no excalidraw.com.',
    error_sceneTooBig:
      'Essa cena tem {mb} MB. O limite é {cap} MB: é grande demais para abrir aqui.',
    error_fileEmpty: 'Esse arquivo está vazio.',
    error_notJson: 'Esse arquivo não é JSON válido, então não é uma cena .excalidraw.',
    error_notSceneObject: 'Esse arquivo não contém um objeto de cena .excalidraw.',
    error_shapeLibrary:
      'Isso é uma biblioteca de formas do Excalidraw (.excalidrawlib), não um desenho. Abra-a pelo painel de biblioteca.',
    error_wrongType:
      'Não é uma cena do Excalidraw: o campo "type" diz "{type}", esperado "excalidraw".',
    error_missingType:
      'Não é uma cena do Excalidraw: o campo "type" não diz nada, esperado "excalidraw".',
    error_noVersion: 'Essa cena não tem número de versão, então não pode ser lida com segurança.',
    error_newerVersion:
      'Essa cena é a versão {version}; esta ferramenta lê até a versão {max}. Ela foi salva por um Excalidraw mais novo.',
    error_noElements: 'Essa cena não tem um array "elements": não há nada para desenhar.',
  },
};
