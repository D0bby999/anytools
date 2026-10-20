/**
 * tools/anylearn-page.ts
 * The words of `/{locale}/anylearn`, AnyLearn's page on the AnyTools site, in
 * the four public languages. Kept here, like a tool's strings.ts, rather than
 * in pages.json: the page is one block of copy that changes together.
 *
 * Every claim is one the product makes elsewhere (README, the landing page,
 * docs/learning-features.md). The app itself is in English; the page says so
 * in the other three languages.
 */
import type { PublicLng } from "~/lib/i18n";

export type AnyLearnCopy = {
  metaTitle: string;
  metaDescription: string;
  badge: string;
  tagline: string;
  intro: string;
  cta: string;
  ctaNote: string;
  howToInstall: string;
  englishNote?: string;
  featuresTitle: string;
  features: { title: string; body: string }[];
  installTitle: string;
  installLead: string;
  install: { os: string; steps: string[] }[];
  notTitle: string;
  not: string;
};

const en: AnyLearnCopy = {
  metaTitle: "AnyLearn: study your PDFs with AI, with quizzes and review",
  metaDescription:
    "A free study app that answers from your documents with citations to the page, writes quizzes from them, and times your reviews to just before you forget. Runs on your own AI account.",
  badge: "Free · Your own AI · Early access",
  tagline: "Study from your own documents, and check every answer against the page.",
  intro:
    "AnyLearn is the study app in AnyTools. Upload what you are learning from. It answers questions about it with citations that open the exact page, writes quizzes from it, schedules what you are about to forget, and keeps a 90-day record of what you can actually do, all on the AI accounts you already have.",
  cta: "Start studying",
  ctaNote: "Google or GitHub sign-in; no password.",
  howToInstall: "Install it on your phone or computer",
  featuresTitle: "What it does",
  features: [
    {
      title: "Answers that point at the page",
      body: "Chat, quizzes and research cite the passage they used, and a citation opens your document at that page. When your documents do not cover a question, it says so.",
    },
    {
      title: "Practice that schedules itself",
      body: "Questions are written from your material and marked with an explanation. A mastery path (FSRS) brings back what you got wrong the same day, and what you know just before you would forget it.",
    },
    {
      title: "A daily review reminder",
      body: "Once a day, at the hour you choose, your phone or computer is told how many review points are due. Nothing on a day with nothing due, and no streaks.",
    },
    {
      title: "Progress backed by evidence",
      body: "A 90-day learning loop moves forward only when quiz results, reviews and notes show it should, not when a box is ticked.",
    },
    {
      title: "Any source you study from",
      body: "PDFs and documents, web pages and documentation sites, YouTube videos and playlists, podcasts, audio, photos of pages, Google Drive, GitHub repositories and a Zotero library.",
    },
    {
      title: "Your own AI accounts",
      body: "Connect a key from Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek, Qwen, Mistral or another provider. There are no platform keys and no credits.",
    },
  ],
  installTitle: "Install it",
  installLead:
    "AnyLearn is a web app you can install: it opens in its own window, and only an installed AnyLearn on iPhone or iPad can receive the review reminder.",
  install: [
    {
      os: "iPhone and iPad",
      steps: [
        "Open anytools.world in Safari and sign in.",
        "Tap the Share button, then Add to Home Screen, and leave Open as Web App on.",
        "Open AnyLearn from your Home Screen, then Settings, then Reminders, and turn the reminder on.",
      ],
    },
    {
      os: "Android",
      steps: [
        "Open anytools.world in Chrome and sign in.",
        "Open the menu and choose Install app (or Add to Home screen).",
        "In AnyLearn, open Settings, then Reminders, and turn the reminder on.",
      ],
    },
    {
      os: "Computer",
      steps: [
        "Open anytools.world in Chrome or Edge and sign in, then choose Install in the address bar or the menu.",
        "In Safari on a Mac, choose File, then Add to Dock.",
        "In AnyLearn, open Settings, then Reminders, to install it or turn the reminder on.",
      ],
    },
  ],
  notTitle: "What it will not do",
  not: "AnyLearn does not answer from its own general knowledge when your documents are silent. It does not keep streaks, points or badges. And it cannot promise that a file never reaches an AI provider: reading a document means sending it to the model you chose, and every document shows which one read it.",
};

const vi: AnyLearnCopy = {
  metaTitle: "AnyLearn: học từ tài liệu bằng AI, tạo câu hỏi trắc nghiệm",
  metaDescription:
    "Ứng dụng học miễn phí: trả lời từ tài liệu của bạn kèm trích dẫn tới đúng trang, soạn câu hỏi luyện tập từ tài liệu và hẹn lịch ôn ngay trước lúc bạn sắp quên. Chạy bằng tài khoản AI của chính bạn.",
  badge: "Miễn phí · AI của bạn · Bản dùng sớm",
  tagline: "Học từ chính tài liệu của bạn, và đối chiếu mọi câu trả lời với đúng trang.",
  intro:
    "AnyLearn là ứng dụng học trong AnyTools. Bạn tải lên tài liệu đang học. AnyLearn trả lời câu hỏi về tài liệu đó, kèm trích dẫn mở đúng trang, soạn câu hỏi luyện tập từ tài liệu, hẹn lịch ôn những gì bạn sắp quên, và ghi lại 90 ngày những gì bạn thật sự làm được, tất cả chạy trên tài khoản AI bạn đã có.",
  cta: "Bắt đầu học",
  ctaNote: "Đăng nhập bằng Google hoặc GitHub, không cần mật khẩu.",
  howToInstall: "Cài lên điện thoại hoặc máy tính",
  englishNote:
    "Giao diện AnyLearn hiện bằng tiếng Anh. Tài liệu của bạn có thể bằng tiếng Việt, và chat trả lời bằng ngôn ngữ bạn hỏi.",
  featuresTitle: "AnyLearn làm gì",
  features: [
    {
      title: "Câu trả lời chỉ đúng trang",
      body: "Chat, câu hỏi luyện tập và báo cáo nghiên cứu đều trích đoạn chúng đã dùng; bấm vào trích dẫn là mở tài liệu ở đúng trang đó. Khi tài liệu không nói tới, AnyLearn nói thẳng là không có.",
    },
    {
      title: "Luyện tập tự lên lịch",
      body: "Câu hỏi được soạn từ chính tài liệu của bạn và chấm kèm giải thích. Lộ trình ôn (FSRS) đưa lại câu bạn làm sai ngay trong ngày, và câu bạn đã biết vào đúng lúc bạn sắp quên.",
    },
    {
      title: "Nhắc ôn mỗi ngày",
      body: "Mỗi ngày một lần, vào giờ bạn chọn, điện thoại hoặc máy tính báo có bao nhiêu điểm cần ôn. Ngày nào không có gì đến hạn thì không nhắc, và không có chuỗi ngày phải giữ.",
    },
    {
      title: "Tiến bộ có bằng chứng",
      body: "Vòng học 90 ngày chỉ tiến lên khi kết quả làm bài, lượt ôn và ghi chú cho thấy bạn đã tiến bộ, không phải khi bạn tự đánh dấu xong.",
    },
    {
      title: "Học từ mọi nguồn",
      body: "PDF và tài liệu, trang web và trang tài liệu kỹ thuật, video và danh sách phát YouTube, podcast, file âm thanh, ảnh chụp trang sách, Google Drive, kho GitHub và thư viện Zotero.",
    },
    {
      title: "Dùng tài khoản AI của bạn",
      body: "Kết nối khóa API của Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek, Qwen, Mistral hoặc nhà cung cấp khác. Không có khóa của nền tảng, không có gói tín dụng.",
    },
  ],
  installTitle: "Cài đặt",
  installLead:
    "AnyLearn là web app cài được như ứng dụng: mở trong cửa sổ riêng, và trên iPhone hoặc iPad thì phải cài lên Màn hình chính mới nhận được lời nhắc ôn.",
  install: [
    {
      os: "iPhone và iPad",
      steps: [
        "Mở anytools.world bằng Safari và đăng nhập.",
        "Bấm nút Chia sẻ, chọn Thêm vào Màn hình chính, và để bật Mở dưới dạng ứng dụng web.",
        "Mở AnyLearn từ Màn hình chính, vào Settings, rồi Reminders, và bật lời nhắc.",
      ],
    },
    {
      os: "Android",
      steps: [
        "Mở anytools.world bằng Chrome và đăng nhập.",
        "Mở menu, chọn Cài đặt ứng dụng (hoặc Thêm vào màn hình chính).",
        "Trong AnyLearn, vào Settings, rồi Reminders, và bật lời nhắc.",
      ],
    },
    {
      os: "Máy tính",
      steps: [
        "Mở anytools.world bằng Chrome hoặc Edge và đăng nhập, rồi chọn Cài đặt trên thanh địa chỉ hoặc trong menu.",
        "Trên Safari của máy Mac, chọn File, rồi Add to Dock.",
        "Trong AnyLearn, vào Settings, rồi Reminders, để cài đặt hoặc bật lời nhắc.",
      ],
    },
  ],
  notTitle: "Những gì AnyLearn không làm",
  not: "AnyLearn không tự trả lời bằng kiến thức chung khi tài liệu của bạn không nói tới. Không có chuỗi ngày, điểm hay huy hiệu. Và không thể hứa rằng tài liệu không bao giờ tới nhà cung cấp AI: đọc một tài liệu nghĩa là gửi nó tới mô hình bạn chọn, và mỗi tài liệu đều ghi rõ mô hình nào đã đọc nó.",
};

const es: AnyLearnCopy = {
  metaTitle: "AnyLearn: estudia tus PDF con IA: cuestionarios y repasos",
  metaDescription:
    "Una app de estudio gratuita que responde a partir de tus documentos citando la página, crea cuestionarios con ellos y programa tus repasos justo antes de que olvides. Funciona con tu propia cuenta de IA.",
  badge: "Gratis · Tu propia IA · Acceso anticipado",
  tagline: "Estudia con tus propios documentos y comprueba cada respuesta en la página.",
  intro:
    "AnyLearn es la app de estudio de AnyTools. Sube el material con el que estudias. Responde preguntas sobre él con citas que abren la página exacta, crea cuestionarios a partir de él, programa lo que estás a punto de olvidar y guarda un registro de 90 días de lo que de verdad sabes hacer, todo con las cuentas de IA que ya tienes.",
  cta: "Empezar a estudiar",
  ctaNote: "Inicio de sesión con Google o GitHub; sin contraseña.",
  howToInstall: "Instálala en tu móvil o tu ordenador",
  englishNote:
    "La interfaz de AnyLearn está en inglés. Tus documentos pueden estar en español, y el chat responde en el idioma en que preguntas.",
  featuresTitle: "Qué hace",
  features: [
    {
      title: "Respuestas que señalan la página",
      body: "El chat, los cuestionarios y los informes citan el pasaje que usaron, y cada cita abre tu documento en esa página. Si tus documentos no cubren una pregunta, lo dice.",
    },
    {
      title: "Práctica que se programa sola",
      body: "Las preguntas salen de tu material y se corrigen con una explicación. Una ruta de dominio (FSRS) te devuelve lo que fallaste el mismo día, y lo que sabes justo antes de que lo olvides.",
    },
    {
      title: "Un recordatorio de repaso al día",
      body: "Una vez al día, a la hora que elijas, tu móvil o tu ordenador te dice cuántos puntos tienes para repasar. Nada los días sin repasos pendientes, y sin rachas.",
    },
    {
      title: "Progreso con pruebas",
      body: "Un ciclo de aprendizaje de 90 días solo avanza cuando los resultados, los repasos y las notas lo muestran, no cuando marcas una casilla.",
    },
    {
      title: "Cualquier fuente con la que estudies",
      body: "PDF y documentos, páginas web y sitios de documentación, vídeos y listas de YouTube, pódcasts, audio, fotos de páginas, Google Drive, repositorios de GitHub y una biblioteca de Zotero.",
    },
    {
      title: "Tus propias cuentas de IA",
      body: "Conecta una clave de Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek, Qwen, Mistral u otro proveedor. No hay claves de la plataforma ni créditos.",
    },
  ],
  installTitle: "Instalarla",
  installLead:
    "AnyLearn es una app web que se puede instalar: se abre en su propia ventana, y en iPhone o iPad solo la instalada en la pantalla de inicio recibe el recordatorio.",
  install: [
    {
      os: "iPhone y iPad",
      steps: [
        "Abre anytools.world en Safari e inicia sesión.",
        "Toca Compartir, luego Añadir a pantalla de inicio, y deja activado Abrir como app web.",
        "Abre AnyLearn desde la pantalla de inicio, ve a Settings y luego a Reminders, y activa el recordatorio.",
      ],
    },
    {
      os: "Android",
      steps: [
        "Abre anytools.world en Chrome e inicia sesión.",
        "Abre el menú y elige Instalar aplicación (o Añadir a pantalla de inicio).",
        "En AnyLearn, ve a Settings y luego a Reminders, y activa el recordatorio.",
      ],
    },
    {
      os: "Ordenador",
      steps: [
        "Abre anytools.world en Chrome o Edge, inicia sesión y elige Instalar en la barra de direcciones o en el menú.",
        "En Safari en un Mac, elige Archivo y luego Añadir al Dock.",
        "En AnyLearn, ve a Settings y luego a Reminders para instalarla o activar el recordatorio.",
      ],
    },
  ],
  notTitle: "Lo que no hace",
  not: "AnyLearn no responde con su conocimiento general cuando tus documentos no dicen nada. No tiene rachas, puntos ni insignias. Y no puede prometer que un archivo nunca llegue a un proveedor de IA: leer un documento significa enviarlo al modelo que elegiste, y cada documento muestra cuál lo leyó.",
};

const pt: AnyLearnCopy = {
  metaTitle: "AnyLearn: estude seus PDFs com IA, com quizzes e revisões",
  metaDescription:
    "Um app de estudo gratuito que responde a partir dos seus documentos citando a página, cria quizzes com eles e marca suas revisões para pouco antes de você esquecer. Funciona com a sua própria conta de IA.",
  badge: "Grátis · Sua própria IA · Acesso antecipado",
  tagline: "Estude com seus próprios documentos e confira cada resposta na página.",
  intro:
    "O AnyLearn é o app de estudo do AnyTools. Envie o material que você está estudando. Ele responde perguntas sobre esse material com citações que abrem a página exata, cria quizzes a partir dele, agenda o que você está prestes a esquecer e mantém um registro de 90 dias do que você realmente sabe fazer, tudo com as contas de IA que você já tem.",
  cta: "Começar a estudar",
  ctaNote: "Entrada com Google ou GitHub; sem senha.",
  howToInstall: "Instale no celular ou no computador",
  englishNote:
    "A interface do AnyLearn é em inglês. Seus documentos podem estar em português, e o chat responde no idioma em que você pergunta.",
  featuresTitle: "O que ele faz",
  features: [
    {
      title: "Respostas que apontam a página",
      body: "O chat, os quizzes e os relatórios citam o trecho que usaram, e cada citação abre seu documento naquela página. Quando seus documentos não cobrem uma pergunta, ele diz isso.",
    },
    {
      title: "Prática que se agenda sozinha",
      body: "As perguntas saem do seu material e são corrigidas com uma explicação. Uma trilha de domínio (FSRS) traz de volta no mesmo dia o que você errou, e o que você sabe pouco antes de esquecer.",
    },
    {
      title: "Um lembrete de revisão por dia",
      body: "Uma vez por dia, na hora que você escolher, seu celular ou computador avisa quantos pontos estão para revisar. Nada nos dias sem revisão pendente, e sem sequências.",
    },
    {
      title: "Progresso com evidências",
      body: "Um ciclo de aprendizagem de 90 dias só avança quando resultados, revisões e notas mostram que deve, não quando você marca uma caixa.",
    },
    {
      title: "Qualquer fonte de estudo",
      body: "PDFs e documentos, páginas web e sites de documentação, vídeos e playlists do YouTube, podcasts, áudio, fotos de páginas, Google Drive, repositórios do GitHub e uma biblioteca do Zotero.",
    },
    {
      title: "Suas próprias contas de IA",
      body: "Conecte uma chave do Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek, Qwen, Mistral ou outro provedor. Não há chaves da plataforma nem créditos.",
    },
  ],
  installTitle: "Instalar",
  installLead:
    "O AnyLearn é um app web que pode ser instalado: abre em sua própria janela, e no iPhone ou iPad só o instalado na Tela de Início recebe o lembrete.",
  install: [
    {
      os: "iPhone e iPad",
      steps: [
        "Abra anytools.world no Safari e entre.",
        "Toque em Compartilhar, depois em Adicionar à Tela de Início, e deixe Abrir como App Web ativado.",
        "Abra o AnyLearn pela Tela de Início, vá em Settings e depois em Reminders, e ative o lembrete.",
      ],
    },
    {
      os: "Android",
      steps: [
        "Abra anytools.world no Chrome e entre.",
        "Abra o menu e escolha Instalar app (ou Adicionar à tela inicial).",
        "No AnyLearn, vá em Settings e depois em Reminders, e ative o lembrete.",
      ],
    },
    {
      os: "Computador",
      steps: [
        "Abra anytools.world no Chrome ou no Edge, entre e escolha Instalar na barra de endereços ou no menu.",
        "No Safari do Mac, escolha Arquivo e depois Adicionar ao Dock.",
        "No AnyLearn, vá em Settings e depois em Reminders para instalar ou ativar o lembrete.",
      ],
    },
  ],
  notTitle: "O que ele não faz",
  not: "O AnyLearn não responde com conhecimento geral quando seus documentos não dizem nada. Não tem sequências, pontos nem medalhas. E não pode prometer que um arquivo nunca chegue a um provedor de IA: ler um documento significa enviá-lo ao modelo que você escolheu, e cada documento mostra qual modelo o leu.",
};

const COPY: Record<PublicLng, AnyLearnCopy> = { en, vi, es, pt };

export function anyLearnCopy(locale: PublicLng): AnyLearnCopy {
  return COPY[locale];
}
