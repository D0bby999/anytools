type Locale = 'en' | 'vi' | 'es' | 'pt';

export type LegalPage = {
  title: string;
  sections: { heading: string; body: string[] }[];
  lastUpdated: string;
};

export const LAST_UPDATED = '2026-09-02';

const PRIVACY: Record<Locale, LegalPage> = {
  en: {
    title: 'Privacy Policy',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Summary',
        body: [
          'AnyTools is built around a simple principle: your tool inputs never leave your browser. JSON you paste, files you upload, passwords you generate — all of it is processed locally on your device using JavaScript that runs in your browser. We have no servers that store, log, or analyze the data you put into the tools.',
          'The one exception is the curl-to-code converter, which uses a Node.js parser server-side because the underlying tree-sitter library cannot run in browsers. In that case, the curl command is sent over HTTPS, parsed, and discarded — never logged or stored.',
        ],
      },
      {
        heading: 'What we collect',
        body: [
          'Aggregate, anonymized analytics through Umami Analytics: page views, referrer, country (from IP), device type. No personally identifiable information, no cookies, no cross-site tracking. You can opt out at any time via our cookie consent banner.',
          'If you join the waitlist or newsletter, we collect the email address you provide. Used only to send you product updates. Stored at our email provider (Resend / Loops). You can unsubscribe from any email or request deletion at any time.',
          'If you submit a contact form or report a bug, we collect what you write so we can respond.',
          'If you create an account, we store your email address and a hashed password on our server so you can sign in. Social sign-in stores the identifier your provider returns instead. Ask us and we will delete the account and its data.',
        ],
      },
      {
        heading: 'What we do not collect',
        body: [
          'Your tool inputs — these stay in your browser. We do not have copies of the JSON you formatted, the regexes you tested, the passwords you generated, the files you converted, or anything else.',
          'Personally identifiable information beyond what you explicitly provide (email for waitlist, message body for contact).',
          'Behavior tracking that we run ourselves. We operate no trackers, ad pixels, or session-replay tools of our own. We do embed one third-party script: Google AdSense loads on every page — see “Third parties” below for what that means.',
        ],
      },
      {
        heading: 'Cookies',
        body: [
          'We set one first-party cookie to remember your locale. Your cookie choice is not a cookie — it is kept in your browser’s local storage. If you sign in, we also set a session cookie. Tool history, favourites and recent tools are stored in your browser only and never reach us. If you consent to ads, AdSense may set additional cookies governed by Google’s policies.',
          'You can revoke consent at any time. Our analytics stays off until you consent. The AdSense script itself loads on every page regardless of your choice, so Google may set its own cookies before you decide — your consent controls whether we show ads and whether analytics runs, not whether Google’s script is present.',
        ],
      },
      {
        heading: 'Third parties',
        body: [
          'Hosting: Hetzner (Germany, EU). Analytics: Umami (self-hosted, EU). Email: Resend / Loops (US). Ads: Google AdSense — its script is present on every page, including before you make a cookie choice. CDN: Cloudflare. Each operates under its own privacy policy.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'You can request a copy of any data we hold about you, request correction, or request deletion by emailing chaudai621@gmail.com. We respond within 30 days. EU users have additional rights under GDPR; Vietnamese users under PDPA; California residents under CCPA.',
        ],
      },
      {
        heading: 'Children',
        body: [
          'AnyTools is not directed at children under 13. We do not knowingly collect data from children. If you believe a child has provided us with information, please contact us so we can delete it.',
        ],
      },
      {
        heading: 'Changes',
        body: [
          'We will update this policy as the product evolves. Material changes will be announced via email to newsletter subscribers and via a banner on the site for 30 days.',
        ],
      },
      {
        heading: 'Contact',
        body: [
          'Email: chaudai621@gmail.com. We aim to respond within two business days.',
          'AnyTools is operated by Cassau, LLC, a Delaware limited liability company. Registered agent: Legalinc Corporate Services Inc., 131 Continental Dr, Suite 305, Newark, DE 19713, USA.',
        ],
      },
    ],
  },
  vi: {
    title: 'Chính sách bảo mật',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Tóm tắt',
        body: [
          'AnyTools xây dựng quanh nguyên tắc đơn giản: input của bạn không bao giờ rời khỏi trình duyệt. JSON bạn paste, file bạn upload, password bạn generate — tất cả xử lý cục bộ trên thiết bị của bạn bằng JavaScript chạy trong browser. Chúng tôi không có server nào lưu, log, hay phân tích dữ liệu bạn đưa vào tool.',
          'Ngoại lệ duy nhất là tool curl-to-code converter, dùng parser Node.js server-side vì thư viện tree-sitter không chạy được trong browser. Trong trường hợp này, lệnh curl được gửi qua HTTPS, parse, rồi xóa — không log, không lưu.',
        ],
      },
      {
        heading: 'Chúng tôi thu thập gì',
        body: [
          'Analytics aggregate, ẩn danh qua Umami Analytics: lượt xem trang, referrer, quốc gia (từ IP), loại thiết bị. Không có thông tin cá nhân, không cookie, không tracking cross-site. Bạn có thể opt out bất cứ lúc nào qua banner cookie consent.',
          'Nếu bạn vào waitlist hoặc newsletter, chúng tôi thu thập email bạn cung cấp. Chỉ dùng để gửi cập nhật sản phẩm. Lưu tại nhà cung cấp email (Resend / Loops). Có thể unsubscribe từ bất kỳ email nào hoặc yêu cầu xóa bất cứ lúc nào.',
          'Nếu bạn gửi form liên hệ hoặc báo lỗi, chúng tôi lưu nội dung để phản hồi.',
          'Nếu bạn tạo tài khoản, chúng tôi lưu email và mật khẩu đã băm trên máy chủ để bạn đăng nhập được. Đăng nhập bằng mạng xã hội thì lưu định danh do nhà cung cấp trả về. Bạn yêu cầu là chúng tôi xoá tài khoản cùng dữ liệu của nó.',
        ],
      },
      {
        heading: 'Chúng tôi KHÔNG thu thập',
        body: [
          'Input tool của bạn — toàn bộ ở trong browser. Chúng tôi không có bản sao của JSON bạn format, regex bạn test, password bạn tạo, file bạn convert, hay bất kỳ thứ gì khác.',
          'Thông tin định danh cá nhân ngoài những gì bạn chủ động cung cấp (email waitlist, nội dung contact).',
          'Tracking hành vi do chính chúng tôi thực hiện. Chúng tôi không tự vận hành tracker, ad pixel, hay session replay nào. Nhưng chúng tôi CÓ nhúng một script bên thứ ba: Google AdSense tải trên mọi trang — xem mục “Bên thứ ba” bên dưới.',
        ],
      },
      {
        heading: 'Cookies',
        body: [
          'Chúng tôi đặt một cookie first-party để nhớ ngôn ngữ. Lựa chọn cookie của bạn KHÔNG phải cookie — nó nằm trong local storage của trình duyệt. Nếu bạn đăng nhập, chúng tôi đặt thêm một cookie phiên. Lịch sử tool, tool yêu thích và tool vừa dùng chỉ nằm trong trình duyệt bạn, không gửi về chúng tôi. Nếu bạn đồng ý nhận ads, AdSense có thể đặt thêm cookie theo chính sách của Google.',
          'Bạn có thể thu hồi consent bất cứ lúc nào. Analytics của chúng tôi tắt cho tới khi bạn đồng ý. Nhưng script AdSense thì tải trên mọi trang bất kể bạn chọn gì, nên Google có thể đặt cookie riêng trước khi bạn quyết định — consent của bạn quyết định việc chúng tôi hiển thị quảng cáo và chạy analytics, không quyết định việc script của Google có mặt hay không.',
        ],
      },
      {
        heading: 'Bên thứ ba',
        body: [
          'Hosting: Hetzner (Đức, EU). Analytics: Umami (self-hosted, EU). Email: Resend / Loops (US). Ads: Google AdSense — script có mặt trên mọi trang, kể cả trước khi bạn chọn cookie. CDN: Cloudflare. Mỗi đơn vị vận hành theo chính sách riêng.',
        ],
      },
      {
        heading: 'Quyền của bạn',
        body: [
          'Bạn có thể yêu cầu bản sao dữ liệu chúng tôi có về bạn, yêu cầu chỉnh sửa, hoặc yêu cầu xóa qua email chaudai621@gmail.com. Chúng tôi phản hồi trong 30 ngày. Người dùng EU có thêm quyền theo GDPR; Việt Nam theo PDPA; California theo CCPA.',
        ],
      },
      {
        heading: 'Trẻ em',
        body: [
          'AnyTools không hướng đến trẻ em dưới 13 tuổi. Chúng tôi không cố ý thu thập dữ liệu từ trẻ em. Nếu bạn tin trẻ em đã cung cấp thông tin cho chúng tôi, vui lòng liên hệ để chúng tôi xóa.',
        ],
      },
      {
        heading: 'Thay đổi',
        body: [
          'Chúng tôi cập nhật chính sách khi sản phẩm phát triển. Thay đổi quan trọng sẽ thông báo qua email cho subscribers và banner trên site trong 30 ngày.',
        ],
      },
      {
        heading: 'Liên hệ',
        body: ['Email: chaudai621@gmail.com. Phản hồi trong 2 ngày làm việc.'],
      },
    ],
  },
  es: {
    title: 'Política de privacidad',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Resumen',
        body: [
          'AnyTools se basa en un principio simple: tus datos de entrada nunca salen de tu navegador. El JSON que pegas, los archivos que subes, las contraseñas que generas — todo se procesa localmente en tu dispositivo usando JavaScript que corre en tu navegador. No tenemos servidores que almacenen, registren o analicen los datos que pones en las herramientas.',
          'La única excepción es el conversor curl-to-code, que usa un parser de Node.js del lado del servidor porque la librería tree-sitter subyacente no puede ejecutarse en navegadores. En ese caso, el comando curl se envía por HTTPS, se analiza y se descarta — nunca se registra ni almacena.',
        ],
      },
      {
        heading: 'Qué recopilamos',
        body: [
          'Analítica agregada y anónima mediante Umami Analytics: vistas de página, referente, país (por IP), tipo de dispositivo. Sin información personal identificable, sin cookies, sin seguimiento entre sitios. Puedes desactivarlo en cualquier momento desde el banner de consentimiento.',
          'Si te unes a la lista de espera o boletín, recopilamos el correo que proporcionas. Usado solo para enviarte actualizaciones del producto. Almacenado en el proveedor de email (Resend / Loops). Puedes darte de baja desde cualquier email o solicitar borrado en cualquier momento.',
          'Si envías un formulario de contacto o reportas un bug, guardamos lo que escribes para responderte.',
          'Si creas una cuenta, guardamos tu correo y una contraseña cifrada (hash) en nuestro servidor para que puedas iniciar sesión. El inicio de sesión social guarda el identificador que devuelve tu proveedor. Si nos lo pides, eliminamos la cuenta y sus datos.',
        ],
      },
      {
        heading: 'Qué NO recopilamos',
        body: [
          'Tus datos de entrada — permanecen en tu navegador. No tenemos copias del JSON que formateaste, los regex que probaste, las contraseñas que generaste, los archivos que convertiste, ni nada más.',
          'Información personal identificable más allá de lo que proporcionas explícitamente (email de lista, cuerpo del mensaje de contacto).',
          'Seguimiento de comportamiento realizado por nosotros. No operamos rastreadores, píxeles de anuncios ni herramientas de session replay propios. Sí incrustamos un script de terceros: Google AdSense se carga en todas las páginas — consulta «Terceros» más abajo.',
        ],
      },
      {
        heading: 'Cookies',
        body: [
          'Establecemos una cookie propia para recordar tu idioma. Tu elección sobre cookies NO es una cookie: se guarda en el almacenamiento local de tu navegador. Si inicias sesión, añadimos una cookie de sesión. El historial de herramientas, los favoritos y las herramientas recientes se guardan solo en tu navegador y nunca llegan a nosotros. Si consientes anuncios, AdSense puede establecer cookies adicionales regidas por las políticas de Google.',
          'Puedes revocar el consentimiento en cualquier momento. Nuestra analítica permanece desactivada hasta que consientas. El script de AdSense, en cambio, se carga en todas las páginas independientemente de tu elección, por lo que Google puede establecer sus propias cookies antes de que decidas: tu consentimiento controla si mostramos anuncios y si se ejecuta la analítica, no si el script de Google está presente.',
        ],
      },
      {
        heading: 'Terceros',
        body: [
          'Hospedaje: Hetzner (Alemania, UE). Analítica: Umami (self-hosted, UE). Email: Resend / Loops (US). Anuncios: Google AdSense — su script está presente en todas las páginas, incluso antes de que elijas sobre cookies. CDN: Cloudflare. Cada uno opera bajo su propia política.',
        ],
      },
      {
        heading: 'Tus derechos',
        body: [
          'Puedes pedir copia de los datos que tenemos sobre ti, solicitar corrección o solicitar borrado escribiendo a chaudai621@gmail.com. Respondemos en 30 días. Usuarios de la UE tienen derechos adicionales bajo el RGPD; residentes de California bajo CCPA.',
        ],
      },
      {
        heading: 'Niños',
        body: [
          'AnyTools no está dirigida a menores de 13 años. No recopilamos conscientemente datos de niños. Si crees que un menor nos proporcionó información, contáctanos para borrarla.',
        ],
      },
      {
        heading: 'Cambios',
        body: [
          'Actualizamos esta política conforme evoluciona el producto. Cambios materiales se anuncian por email a suscriptores y mediante un banner en el sitio durante 30 días.',
        ],
      },
      {
        heading: 'Contacto',
        body: ['Email: chaudai621@gmail.com. Respondemos en dos días laborables.'],
      },
    ],
  },
  pt: {
    title: 'Política de Privacidade',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Resumo',
        body: [
          'AnyTools é construído sobre um princípio simples: seus dados de entrada nunca saem do seu navegador. JSON que você cola, arquivos que envia, senhas que gera — tudo é processado localmente no seu dispositivo usando JavaScript que roda no navegador. Não temos servidores que armazenam, registram ou analisam os dados que você coloca nas ferramentas.',
          'A única exceção é o conversor curl-to-code, que usa um parser Node.js no servidor porque a biblioteca tree-sitter subjacente não roda em navegadores. Nesse caso, o comando curl é enviado por HTTPS, analisado e descartado — nunca registrado ou armazenado.',
        ],
      },
      {
        heading: 'O que coletamos',
        body: [
          'Análise agregada e anônima via Umami Analytics: visualizações de página, referência, país (por IP), tipo de dispositivo. Sem informações pessoais identificáveis, sem cookies, sem rastreamento entre sites. Você pode optar por sair a qualquer momento pelo banner de consentimento.',
          'Se entrar na lista de espera ou newsletter, coletamos o email que você fornece. Usado apenas para enviar atualizações do produto. Armazenado no provedor de email (Resend / Loops). Você pode cancelar inscrição em qualquer email ou pedir exclusão a qualquer momento.',
          'Se enviar formulário de contato ou reportar bug, guardamos o que escreve para responder.',
          'Se criar uma conta, guardamos seu e-mail e uma senha com hash em nosso servidor para você poder entrar. O login social guarda o identificador devolvido pelo seu provedor. Se pedir, excluímos a conta e seus dados.',
        ],
      },
      {
        heading: 'O que NÃO coletamos',
        body: [
          'Seus dados de entrada — permanecem no seu navegador. Não temos cópias do JSON que você formatou, regex testou, senhas gerou, arquivos converteu, ou qualquer outra coisa.',
          'Informações pessoais identificáveis além do que você fornece explicitamente (email da lista, corpo do contato).',
          'Rastreamento de comportamento feito por nós. Não operamos rastreadores, pixels de anúncio ou ferramentas de session replay próprios. Incorporamos, sim, um script de terceiros: o Google AdSense carrega em todas as páginas — veja “Terceiros” abaixo.',
        ],
      },
      {
        heading: 'Cookies',
        body: [
          'Definimos um cookie próprio para lembrar seu idioma. Sua escolha sobre cookies NÃO é um cookie: fica no armazenamento local do seu navegador. Se você entrar na conta, adicionamos um cookie de sessão. Histórico de ferramentas, favoritos e ferramentas recentes ficam só no seu navegador e nunca chegam até nós. Se consentir anúncios, AdSense pode definir cookies adicionais governados pelas políticas do Google.',
          'Você pode revogar o consentimento a qualquer momento. Nossa analítica fica desligada até você consentir. O script do AdSense, porém, carrega em todas as páginas independentemente da sua escolha, então o Google pode definir cookies próprios antes de você decidir — seu consentimento controla se exibimos anúncios e se a analítica roda, não se o script do Google está presente.',
        ],
      },
      {
        heading: 'Terceiros',
        body: [
          'Hospedagem: Hetzner (Alemanha, UE). Analítica: Umami (self-hosted, UE). Email: Resend / Loops (US). Anúncios: Google AdSense — o script está presente em todas as páginas, inclusive antes de você escolher sobre cookies. CDN: Cloudflare. Cada um opera sob sua própria política.',
        ],
      },
      {
        heading: 'Seus direitos',
        body: [
          'Você pode pedir cópia dos dados que temos sobre você, solicitar correção ou exclusão escrevendo para chaudai621@gmail.com. Respondemos em 30 dias. Usuários da UE têm direitos adicionais sob GDPR; usuários brasileiros sob LGPD.',
        ],
      },
      {
        heading: 'Crianças',
        body: [
          'AnyTools não é direcionado a menores de 13 anos. Não coletamos conscientemente dados de crianças. Se acreditar que uma criança nos forneceu informações, contate-nos para excluir.',
        ],
      },
      {
        heading: 'Alterações',
        body: [
          'Atualizamos esta política conforme o produto evolui. Mudanças materiais são anunciadas por email a assinantes e via banner no site por 30 dias.',
        ],
      },
      {
        heading: 'Contato',
        body: ['Email: chaudai621@gmail.com. Respondemos em dois dias úteis.'],
      },
    ],
  },
};

const TERMS: Record<Locale, LegalPage> = {
  en: {
    title: 'Terms of Service',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Acceptance',
        body: [
          'By using AnyTools (the "Service") you agree to these Terms. If you do not agree, do not use the Service. We may update these Terms; material changes will be announced via banner on the site for 30 days.',
        ],
      },
      {
        heading: 'License to use',
        body: [
          'The Service and its tools are free for personal and commercial use. Our own code is MIT licensed, open on GitHub, and you may self-host, fork, modify and redistribute it under the MIT terms. It is not all MIT: some third-party components ship under their own licences — including the LGPL-3.0 HEIC decoder behind the HEIC to JPG tool — and every one of them is listed in THIRD-PARTY-NOTICES in the repository.',
        ],
      },
      {
        heading: 'Acceptable use',
        body: [
          'Use the tools only for lawful purposes. Do not use them to process content that is illegal in your jurisdiction, to circumvent security mechanisms, or to attack other systems.',
          'Do not abuse rate limits or attempt to disrupt service availability. We reserve the right to throttle or block abusive clients to protect availability for other users.',
          'Comply with all applicable laws (privacy, copyright, export controls, data protection).',
        ],
      },
      {
        heading: 'No warranty',
        body: [
          'The Service is provided "AS IS" without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that defects will be corrected.',
        ],
      },
      {
        heading: 'Limitation of liability',
        body: [
          'To the maximum extent permitted by law, AnyTools and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, even if advised of the possibility of such damages.',
          'Your sole remedy for dissatisfaction with the Service is to stop using it.',
        ],
      },
      {
        heading: 'User content',
        body: [
          'You retain ownership of any input you process through the tools. Because tool processing happens client-side, we do not receive or store your tool inputs. We do not claim any rights to content you process.',
        ],
      },
      {
        heading: 'Termination',
        body: [
          'You may stop using the Service at any time. We may suspend or terminate access (for example, of waitlist subscribers) for violation of these Terms.',
        ],
      },
      {
        heading: 'Governing law',
        body: [
          'These Terms are governed by the laws of the operator’s jurisdiction, without regard to conflict-of-law principles. Disputes shall be resolved in the operator’s courts.',
        ],
      },
      {
        heading: 'Contact',
        body: [
          'Questions about these Terms? Email chaudai621@gmail.com.',
          'AnyTools is operated by Cassau, LLC, a Delaware limited liability company (registered agent: Legalinc Corporate Services Inc., 131 Continental Dr, Suite 305, Newark, DE 19713, USA). These Terms are governed by the laws of the State of Delaware, USA.',
        ],
      },
    ],
  },
  vi: {
    title: 'Điều khoản dịch vụ',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Chấp nhận',
        body: [
          'Bằng việc sử dụng AnyTools ("Dịch vụ"), bạn đồng ý với các Điều khoản này. Nếu không đồng ý, vui lòng không sử dụng. Chúng tôi có thể cập nhật Điều khoản; thay đổi quan trọng sẽ được thông báo qua banner trên site trong 30 ngày.',
        ],
      },
      {
        heading: 'Quyền sử dụng',
        body: [
          'Dịch vụ và các tool miễn phí cho mục đích cá nhân và thương mại. Code của chúng tôi theo Giấy phép MIT, mở trên GitHub; bạn có thể self-host, fork, sửa đổi và phân phối lại theo điều khoản MIT. Không phải mọi thứ đều MIT: một số thành phần bên thứ ba đi kèm giấy phép riêng — trong đó có decoder HEIC theo LGPL-3.0 mà tool HEIC to JPG dùng — và tất cả được liệt kê trong file THIRD-PARTY-NOTICES của repository.',
        ],
      },
      {
        heading: 'Sử dụng hợp lệ',
        body: [
          'Chỉ sử dụng tool cho mục đích hợp pháp. Không dùng để xử lý nội dung bất hợp pháp tại khu vực của bạn, vượt qua cơ chế bảo mật, hay tấn công hệ thống khác.',
          'Không lạm dụng rate limit hoặc cố gắng phá hoại tính khả dụng dịch vụ. Chúng tôi có quyền hạn chế hoặc chặn client lạm dụng để bảo vệ tính khả dụng cho người dùng khác.',
          'Tuân thủ luật pháp hiện hành (bảo mật, bản quyền, kiểm soát xuất khẩu, bảo vệ dữ liệu).',
        ],
      },
      {
        heading: 'Không bảo hành',
        body: [
          'Dịch vụ được cung cấp "NGUYÊN TRẠNG" không bảo hành dưới bất kỳ hình thức nào, dù tường minh hay ngụ ý, bao gồm tính thương mại, phù hợp mục đích cụ thể, và không xâm phạm. Chúng tôi không đảm bảo Dịch vụ sẽ không gián đoạn, không lỗi, hay khiếm khuyết sẽ được sửa.',
        ],
      },
      {
        heading: 'Giới hạn trách nhiệm',
        body: [
          'Trong phạm vi tối đa luật cho phép, AnyTools và người vận hành không chịu trách nhiệm cho bất kỳ thiệt hại gián tiếp, ngẫu nhiên, đặc biệt, hậu quả, hay trừng phạt nào phát sinh từ việc bạn sử dụng Dịch vụ, ngay cả khi đã được thông báo về khả năng xảy ra.',
          'Biện pháp duy nhất khi không hài lòng với Dịch vụ là ngừng sử dụng.',
        ],
      },
      {
        heading: 'Nội dung người dùng',
        body: [
          'Bạn giữ quyền sở hữu với mọi input bạn xử lý qua tool. Vì việc xử lý diễn ra client-side, chúng tôi không nhận hoặc lưu input của bạn. Chúng tôi không tuyên bố bất kỳ quyền nào với nội dung bạn xử lý.',
        ],
      },
      {
        heading: 'Chấm dứt',
        body: [
          'Bạn có thể ngừng sử dụng Dịch vụ bất cứ lúc nào. Chúng tôi có thể tạm ngừng hoặc chấm dứt quyền truy cập (ví dụ: waitlist) khi vi phạm Điều khoản.',
        ],
      },
      {
        heading: 'Luật áp dụng',
        body: [
          'Điều khoản này được điều chỉnh bởi luật của khu vực tài phán của người vận hành, không xét đến nguyên tắc xung đột luật. Tranh chấp giải quyết tại tòa án của người vận hành.',
        ],
      },
      {
        heading: 'Liên hệ',
        body: ['Thắc mắc về Điều khoản? Email chaudai621@gmail.com.'],
      },
    ],
  },
  es: {
    title: 'Términos de Servicio',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Aceptación',
        body: [
          'Al usar AnyTools (el "Servicio") aceptas estos Términos. Si no estás de acuerdo, no uses el Servicio. Podemos actualizar estos Términos; los cambios materiales se anunciarán mediante un banner en el sitio durante 30 días.',
        ],
      },
      {
        heading: 'Licencia de uso',
        body: [
          'El Servicio y sus herramientas son gratuitos para uso personal y comercial. Nuestro código está bajo la Licencia MIT y abierto en GitHub: puedes auto-hospedarlo, hacer fork, modificarlo y redistribuirlo bajo los términos MIT. No todo es MIT: algunos componentes de terceros vienen con su propia licencia — entre ellos el decodificador HEIC bajo LGPL-3.0 que usa la herramienta HEIC a JPG — y todos están listados en THIRD-PARTY-NOTICES en el repositorio.',
        ],
      },
      {
        heading: 'Uso aceptable',
        body: [
          'Usa las herramientas solo para fines lícitos. No las uses para procesar contenido ilegal en tu jurisdicción, eludir mecanismos de seguridad o atacar otros sistemas.',
          'No abuses de los límites de tasa ni intentes interrumpir la disponibilidad del servicio. Nos reservamos el derecho de limitar o bloquear clientes abusivos para proteger la disponibilidad para otros usuarios.',
          'Cumple con todas las leyes aplicables (privacidad, derechos de autor, controles de exportación, protección de datos).',
        ],
      },
      {
        heading: 'Sin garantía',
        body: [
          'El Servicio se proporciona "TAL CUAL" sin garantía de ningún tipo, expresa o implícita, incluyendo comerciabilidad, idoneidad para un propósito particular y no infracción. No garantizamos que el Servicio sea ininterrumpido, libre de errores, o que se corrijan los defectos.',
        ],
      },
      {
        heading: 'Limitación de responsabilidad',
        body: [
          'En la máxima medida permitida por la ley, AnyTools y sus operadores no serán responsables por daños indirectos, incidentales, especiales, consecuentes o punitivos derivados del uso del Servicio, incluso si se les ha advertido de la posibilidad.',
          'Tu único remedio ante insatisfacción con el Servicio es dejar de usarlo.',
        ],
      },
      {
        heading: 'Contenido del usuario',
        body: [
          'Retienes la propiedad de cualquier entrada que proceses a través de las herramientas. Como el procesamiento ocurre del lado del cliente, no recibimos ni almacenamos tus entradas. No reclamamos derechos sobre el contenido que procesas.',
        ],
      },
      {
        heading: 'Terminación',
        body: [
          'Puedes dejar de usar el Servicio en cualquier momento. Podemos suspender o terminar acceso (por ejemplo, de suscriptores de la lista de espera) por violación de estos Términos.',
        ],
      },
      {
        heading: 'Ley aplicable',
        body: [
          'Estos Términos se rigen por las leyes de la jurisdicción del operador, sin consideración a principios de conflicto de leyes. Las disputas se resolverán en los tribunales del operador.',
        ],
      },
      {
        heading: 'Contacto',
        body: ['¿Preguntas sobre estos Términos? Email chaudai621@gmail.com.'],
      },
    ],
  },
  pt: {
    title: 'Termos de Serviço',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Aceitação',
        body: [
          'Ao usar o AnyTools (o "Serviço") você concorda com estes Termos. Se não concordar, não use o Serviço. Podemos atualizar estes Termos; mudanças materiais serão anunciadas por banner no site por 30 dias.',
        ],
      },
      {
        heading: 'Licença de uso',
        body: [
          'O Serviço e suas ferramentas são gratuitos para uso pessoal e comercial. Nosso código está sob a Licença MIT e aberto no GitHub: você pode auto-hospedar, fazer fork, modificar e redistribuir sob os termos MIT. Nem tudo é MIT: alguns componentes de terceiros vêm com licença própria — entre eles o decodificador HEIC sob LGPL-3.0 usado pela ferramenta HEIC para JPG — e todos estão listados em THIRD-PARTY-NOTICES no repositório.',
        ],
      },
      {
        heading: 'Uso aceitável',
        body: [
          'Use as ferramentas apenas para fins lícitos. Não as use para processar conteúdo ilegal em sua jurisdição, contornar mecanismos de segurança ou atacar outros sistemas.',
          'Não abuse dos limites de taxa nem tente interromper a disponibilidade do serviço. Reservamos o direito de limitar ou bloquear clientes abusivos para proteger a disponibilidade para outros usuários.',
          'Cumpra todas as leis aplicáveis (privacidade, direitos autorais, controles de exportação, proteção de dados).',
        ],
      },
      {
        heading: 'Sem garantia',
        body: [
          'O Serviço é fornecido "NO ESTADO EM QUE SE ENCONTRA" sem garantia de qualquer tipo, expressa ou implícita, incluindo comerciabilidade, adequação a propósito particular e não-violação. Não garantimos que o Serviço será ininterrupto, livre de erros, ou que defeitos serão corrigidos.',
        ],
      },
      {
        heading: 'Limitação de responsabilidade',
        body: [
          'Na máxima extensão permitida por lei, o AnyTools e seus operadores não serão responsáveis por quaisquer danos indiretos, incidentais, especiais, consequentes ou punitivos decorrentes do uso do Serviço, mesmo que avisados da possibilidade.',
          'Sua única solução para insatisfação com o Serviço é parar de usá-lo.',
        ],
      },
      {
        heading: 'Conteúdo do usuário',
        body: [
          'Você mantém a propriedade de qualquer entrada processada nas ferramentas. Como o processamento ocorre no lado do cliente, não recebemos nem armazenamos suas entradas. Não reivindicamos direitos sobre o conteúdo que você processa.',
        ],
      },
      {
        heading: 'Encerramento',
        body: [
          'Você pode parar de usar o Serviço a qualquer momento. Podemos suspender ou encerrar acesso (por exemplo, de assinantes da lista de espera) por violação destes Termos.',
        ],
      },
      {
        heading: 'Lei aplicável',
        body: [
          'Estes Termos são regidos pelas leis da jurisdição do operador, sem considerar princípios de conflito de leis. Disputas serão resolvidas nos tribunais do operador.',
        ],
      },
      {
        heading: 'Contato',
        body: ['Perguntas sobre estes Termos? Email chaudai621@gmail.com.'],
      },
    ],
  },
};

const ABOUT: Record<Locale, LegalPage> = {
  en: {
    title: 'About AnyTools',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'What we build',
        body: [
          'AnyTools is a collection of fast, offline-first developer utilities. JSON formatting, Base64 encoding, UUID generation, regex testing, JWT decoding, password generation, hash computation, SQL formatting, timestamp conversion, and many more — all in one place, free, open source, and respectful of your time and data.',
          'We launched with 25 tools across encoding, formatting, generation, conversion, text/regex, time/date, and web3 categories. New tools ship roughly every two weeks, prioritized by what developers actually search for and ask for in our community.',
        ],
      },
      {
        heading: 'Why we built it',
        body: [
          'Existing dev-tool sites suffer from three problems: aggressive advertising that makes pages slow and noisy; lack of localization for non-English speakers; and content that copies stale Stack Overflow answers without depth. We wanted a clean alternative that loads fast, supports multiple languages from day one, processes data locally for privacy, and provides genuinely useful tutorials alongside each tool.',
          'The product is built by a small team that uses these tools daily. Every tool we ship is one we use ourselves at work.',
        ],
      },
      {
        heading: 'How we are funded',
        body: [
          'We keep the lights on through unobtrusive AdSense placements (after AdSense approval), occasional sponsored placements from companies developers actually use, affiliate links to relevant tools and books, and a future paid tier for power-user features (no ads, batch processing, custom workflows). Everything in the free tier today will remain free; paid features are strictly additive.',
        ],
      },
      {
        heading: 'Our principles',
        body: [
          'Privacy first: your tool inputs never leave your browser unless explicitly required (curl converter only).',
          'Open source: every tool’s code is on GitHub under the MIT License. Audit it, fork it, self-host it.',
          'Multi-language: English, Vietnamese, Spanish, and Portuguese supported from day one. More locales as demand grows.',
          'No dark patterns: no popups, no exit-intent modals, no fake urgency, no email-gated content.',
          'Performance: Lighthouse 95+ on every tool page. Bundles split per-tool so you only load what you need.',
        ],
      },
      {
        heading: 'Get in touch',
        body: [
          'Have a tool request? Found a bug? Want to partner? Email chaudai621@gmail.com or open an issue on GitHub. We read everything.',
        ],
      },
    ],
  },
  vi: {
    title: 'Về AnyTools',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Chúng tôi xây gì',
        body: [
          'AnyTools là bộ sưu tập các tiện ích dev nhanh, offline-first. Format JSON, encode Base64, tạo UUID, test regex, decode JWT, sinh password, tính hash, format SQL, chuyển timestamp, và nhiều thứ khác — tất cả ở một nơi, miễn phí, mã nguồn mở, và tôn trọng thời gian + dữ liệu của bạn.',
          'Chúng tôi ra mắt với 25 tool thuộc nhóm encoding, formatter, generator, converter, text/regex, time/date và web3. Tool mới ship khoảng 2 tuần/lần, ưu tiên theo những gì dev thực sự search và yêu cầu trong cộng đồng.',
        ],
      },
      {
        heading: 'Tại sao chúng tôi xây',
        body: [
          'Các site dev-tool hiện tại có 3 vấn đề: quảng cáo nhồi nhét làm trang chậm + ồn; thiếu localization cho người không nói tiếng Anh; nội dung copy lời giải cũ trên Stack Overflow không có chiều sâu. Chúng tôi muốn một lựa chọn sạch, load nhanh, đa ngôn ngữ từ ngày đầu, xử lý dữ liệu cục bộ vì quyền riêng tư, và cung cấp tutorial thực sự hữu ích bên cạnh mỗi tool.',
          'Sản phẩm do một team nhỏ — chính những người dùng tool này hằng ngày — xây dựng. Mọi tool ship đều là tool team dùng ở chỗ làm.',
        ],
      },
      {
        heading: 'Nguồn thu',
        body: [
          'Chúng tôi vận hành bằng vị trí AdSense không xâm phạm (sau khi AdSense duyệt), thỉnh thoảng có sponsored placement từ công ty dev thực sự dùng, affiliate link đến tool/sách liên quan, và tier trả phí trong tương lai cho power user (không ads, batch processing, workflow tùy biến). Mọi thứ free hôm nay sẽ vẫn free; tính năng trả phí chỉ thêm vào, không cắt đi.',
        ],
      },
      {
        heading: 'Nguyên tắc',
        body: [
          'Quyền riêng tư là trên hết: input của bạn không rời browser trừ khi bắt buộc (chỉ curl converter).',
          'Mã nguồn mở: code mỗi tool trên GitHub theo MIT. Audit, fork, self-host thoải mái.',
          'Đa ngôn ngữ: English, Tiếng Việt, Spanish, Portuguese hỗ trợ từ ngày đầu. Thêm locale khi nhu cầu tăng.',
          'Không dark pattern: không popup, không modal exit-intent, không tạo cảm giác khẩn cấp giả, không content gate bằng email.',
          'Hiệu năng: Lighthouse 95+ trên mọi trang tool. Bundle split theo tool, bạn chỉ load thứ cần.',
        ],
      },
      {
        heading: 'Liên hệ',
        body: [
          'Có yêu cầu tool? Tìm thấy bug? Muốn hợp tác? Email chaudai621@gmail.com hoặc mở issue trên GitHub. Chúng tôi đọc hết.',
        ],
      },
    ],
  },
  es: {
    title: 'Acerca de AnyTools',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Qué construimos',
        body: [
          'AnyTools es una colección de utilidades rápidas y offline-first para desarrolladores. Formateo de JSON, codificación Base64, generación de UUID, pruebas de regex, decodificación de JWT, generación de contraseñas, cálculo de hashes, formateo de SQL, conversión de timestamps, y muchas más — todo en un lugar, gratis, código abierto y respetuoso con tu tiempo y datos.',
          'Lanzamos con 25 herramientas en categorías de codificación, formateadores, generadores, conversores, texto/regex, tiempo/fecha y web3. Nuevas herramientas llegan aproximadamente cada dos semanas, priorizadas por lo que los desarrolladores realmente buscan y piden en nuestra comunidad.',
        ],
      },
      {
        heading: 'Por qué',
        body: [
          'Los sitios de herramientas dev existentes sufren de tres problemas: publicidad agresiva que hace las páginas lentas y ruidosas; falta de localización para no angloparlantes; contenido que copia respuestas obsoletas de Stack Overflow sin profundidad. Queríamos una alternativa limpia que cargue rápido, soporte múltiples idiomas desde el día uno, procese datos localmente por privacidad y proporcione tutoriales genuinamente útiles junto a cada herramienta.',
          'El producto lo construye un equipo pequeño que usa estas herramientas a diario. Cada herramienta que enviamos es una que usamos nosotros en el trabajo.',
        ],
      },
      {
        heading: 'Cómo nos financiamos',
        body: [
          'Nos mantenemos con ubicaciones AdSense discretas (tras aprobación AdSense), patrocinios ocasionales de empresas que los desarrolladores realmente usan, enlaces de afiliados a herramientas y libros relevantes, y un futuro nivel de pago para funciones avanzadas (sin anuncios, procesamiento por lotes, flujos personalizados). Todo lo gratis hoy seguirá siendo gratis; las funciones de pago son estrictamente aditivas.',
        ],
      },
      {
        heading: 'Principios',
        body: [
          'Privacidad primero: tus entradas no salen del navegador salvo que sea estrictamente necesario (solo conversor curl).',
          'Código abierto: el código de cada herramienta está en GitHub bajo MIT. Audítalo, hazle fork, auto-hospédalo.',
          'Multi-idioma: inglés, vietnamita, español y portugués desde el primer día. Más idiomas según demanda.',
          'Sin patrones oscuros: sin popups, sin modales de salida, sin urgencia falsa, sin contenido bloqueado tras email.',
          'Rendimiento: Lighthouse 95+ en cada página. Bundles divididos por herramienta para que solo cargues lo que necesitas.',
        ],
      },
      {
        heading: 'Contacto',
        body: [
          '¿Solicitud de herramienta? ¿Bug? ¿Colaboración? Email chaudai621@gmail.com o abre un issue en GitHub. Leemos todo.',
        ],
      },
    ],
  },
  pt: {
    title: 'Sobre o AnyTools',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'O que construímos',
        body: [
          'AnyTools é uma coleção de utilitários rápidos e offline-first para desenvolvedores. Formatação JSON, codificação Base64, geração de UUID, teste de regex, decodificação de JWT, geração de senhas, cálculo de hash, formatação SQL, conversão de timestamps, e muito mais — tudo em um só lugar, grátis, código aberto e respeitando seu tempo e dados.',
          'Lançamos com 25 ferramentas nas categorias de codificação, formatadores, geradores, conversores, texto/regex, tempo/data e web3. Novas ferramentas chegam a cada duas semanas, priorizadas pelo que os desenvolvedores realmente buscam e pedem em nossa comunidade.',
        ],
      },
      {
        heading: 'Por que',
        body: [
          'Sites de ferramentas dev existentes sofrem de três problemas: publicidade agressiva que torna as páginas lentas e ruidosas; falta de localização para não-anglófonos; conteúdo que copia respostas antigas do Stack Overflow sem profundidade. Queríamos uma alternativa limpa que carregue rápido, suporte múltiplos idiomas desde o dia um, processe dados localmente para privacidade e forneça tutoriais genuinamente úteis junto a cada ferramenta.',
          'O produto é construído por uma equipe pequena que usa essas ferramentas diariamente. Cada ferramenta que enviamos é uma que usamos no trabalho.',
        ],
      },
      {
        heading: 'Como nos financiamos',
        body: [
          'Mantemos as luzes acesas com colocações AdSense discretas (após aprovação AdSense), patrocínios ocasionais de empresas que desenvolvedores realmente usam, links de afiliados para ferramentas e livros relevantes, e um futuro nível pago para funcionalidades avançadas (sem anúncios, processamento em lote, fluxos personalizados). Tudo que é grátis hoje continuará grátis; funcionalidades pagas são estritamente adicionais.',
        ],
      },
      {
        heading: 'Princípios',
        body: [
          'Privacidade primeiro: suas entradas não saem do navegador a menos que estritamente necessário (apenas conversor curl).',
          'Código aberto: o código de cada ferramenta está no GitHub sob MIT. Audite, faça fork, auto-hospede.',
          'Multi-idioma: inglês, vietnamita, espanhol e português desde o primeiro dia. Mais idiomas conforme a demanda cresce.',
          'Sem padrões obscuros: sem popups, sem modais de saída, sem urgência falsa, sem conteúdo bloqueado por email.',
          'Performance: Lighthouse 95+ em cada página. Bundles divididos por ferramenta para que você carregue apenas o necessário.',
        ],
      },
      {
        heading: 'Contato',
        body: [
          'Solicitação de ferramenta? Bug? Parceria? Email chaudai621@gmail.com ou abra uma issue no GitHub. Lemos tudo.',
        ],
      },
    ],
  },
};

const CONTACT: Record<Locale, LegalPage> = {
  en: {
    title: 'Contact',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Email',
        body: [
          'For anything — feature requests, bug reports, partnership inquiries, press, security disclosures, or just to say hello — write to chaudai621@gmail.com. We aim to respond within two business days.',
        ],
      },
      {
        heading: 'GitHub',
        body: [
          'Code and issue tracker live on GitHub. File issues for bugs, propose enhancements via pull requests, or browse the source. Repository: github.com/D0bby999/anytools.',
        ],
      },
      {
        heading: 'Security',
        body: [
          'Found a vulnerability? Email security@anytools.world with a description and reproduction steps. Please give us a reasonable window before public disclosure. We will acknowledge within 24 hours and aim to ship fixes within seven days.',
        ],
      },
      {
        heading: 'Press / Sponsorship',
        body: [
          'For press inquiries, sponsored placements, or partnership discussions, email chaudai621@gmail.com with "Press" or "Partnership" in the subject line.',
        ],
      },
    ],
  },
  vi: {
    title: 'Liên hệ',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Email',
        body: [
          'Cho mọi thứ — yêu cầu tính năng, báo lỗi, hợp tác, báo chí, công bố lỗ hổng bảo mật, hay chỉ chào hỏi — viết về chaudai621@gmail.com. Chúng tôi cố gắng phản hồi trong 2 ngày làm việc.',
        ],
      },
      {
        heading: 'GitHub',
        body: [
          'Code và issue tracker nằm trên GitHub. Tạo issue cho bug, đề xuất cải tiến qua pull request, hoặc duyệt source code. Repository: github.com/D0bby999/anytools.',
        ],
      },
      {
        heading: 'Bảo mật',
        body: [
          'Phát hiện lỗ hổng? Email security@anytools.world kèm mô tả và bước reproduce. Vui lòng cho chúng tôi một khoảng thời gian hợp lý trước khi công bố công khai. Chúng tôi xác nhận trong 24h và mục tiêu ship fix trong 7 ngày.',
        ],
      },
      {
        heading: 'Báo chí / Tài trợ',
        body: [
          'Cho báo chí, sponsored placement, hoặc thảo luận hợp tác, email chaudai621@gmail.com với "Press" hoặc "Partnership" trong subject.',
        ],
      },
    ],
  },
  es: {
    title: 'Contacto',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Email',
        body: [
          'Para cualquier cosa — solicitudes de funciones, reportes de bugs, consultas de colaboración, prensa, divulgaciones de seguridad o solo saludar — escribe a chaudai621@gmail.com. Buscamos responder en dos días laborables.',
        ],
      },
      {
        heading: 'GitHub',
        body: [
          'El código y el rastreador de issues están en GitHub. Reporta bugs, propón mejoras vía pull request o explora el código. Repositorio: github.com/D0bby999/anytools.',
        ],
      },
      {
        heading: 'Seguridad',
        body: [
          '¿Encontraste una vulnerabilidad? Email security@anytools.world con descripción y pasos de reproducción. Por favor danos una ventana razonable antes de divulgación pública. Confirmamos en 24 horas y apuntamos a publicar correcciones en siete días.',
        ],
      },
      {
        heading: 'Prensa / Patrocinio',
        body: [
          'Para consultas de prensa, ubicaciones patrocinadas o conversaciones de colaboración, email chaudai621@gmail.com con "Press" o "Partnership" en el asunto.',
        ],
      },
    ],
  },
  pt: {
    title: 'Contato',
    lastUpdated: LAST_UPDATED,
    sections: [
      {
        heading: 'Email',
        body: [
          'Para qualquer coisa — solicitações de recursos, relatórios de bugs, consultas de parceria, imprensa, divulgações de segurança ou apenas dizer olá — escreva para chaudai621@gmail.com. Buscamos responder em dois dias úteis.',
        ],
      },
      {
        heading: 'GitHub',
        body: [
          'O código e o rastreador de issues estão no GitHub. Reporte bugs, proponha melhorias via pull request ou explore o código. Repositório: github.com/D0bby999/anytools.',
        ],
      },
      {
        heading: 'Segurança',
        body: [
          'Encontrou uma vulnerabilidade? Email security@anytools.world com descrição e passos de reprodução. Por favor nos dê uma janela razoável antes da divulgação pública. Confirmamos em 24 horas e buscamos publicar correções em sete dias.',
        ],
      },
      {
        heading: 'Imprensa / Patrocínio',
        body: [
          'Para consultas de imprensa, posicionamentos patrocinados ou conversas de parceria, email chaudai621@gmail.com com "Press" ou "Partnership" no assunto.',
        ],
      },
    ],
  },
};

export type LegalPageKey = 'privacy' | 'terms' | 'about' | 'contact';

const REGISTRY: Record<LegalPageKey, Record<Locale, LegalPage>> = {
  privacy: PRIVACY,
  terms: TERMS,
  about: ABOUT,
  contact: CONTACT,
};

export function getLegalPage(key: LegalPageKey, locale: string): LegalPage {
  const l = (['en', 'vi', 'es', 'pt'] as Locale[]).includes(locale as Locale)
    ? (locale as Locale)
    : 'en';
  return REGISTRY[key][l];
}
