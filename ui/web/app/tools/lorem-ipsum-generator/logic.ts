import { LoremIpsum } from 'lorem-ipsum';

export type LoremVariant = 'classic' | 'vietnamese' | 'spanish' | 'hipster';

export type LoremUnit = 'words' | 'sentences' | 'paragraphs';

export type LoremOutput = 'plain' | 'html';

export type LoremOptions = {
  variant?: LoremVariant;
  unit?: LoremUnit;
  count?: number;
  output?: LoremOutput;
  startWithLorem?: boolean;
};

// Word banks for non-classic variants. Vietnamese: pseudo-Latin-flavored common
// Vietnamese words; Spanish: common Spanish nouns/adjectives; Hipster: meme words.
const VIETNAMESE_WORDS = [
  'cà phê',
  'phở',
  'bánh',
  'mì',
  'rau',
  'thịt',
  'gạo',
  'nước',
  'sáng',
  'chiều',
  'tối',
  'đường',
  'chợ',
  'nhà',
  'cây',
  'hoa',
  'mưa',
  'nắng',
  'gió',
  'biển',
  'núi',
  'sông',
  'rừng',
  'làng',
  'người',
  'trẻ',
  'già',
  'vui',
  'buồn',
  'đẹp',
  'nhỏ',
  'lớn',
  'đi',
  'về',
  'ngồi',
  'đứng',
  'cười',
  'nói',
  'nghe',
  'thấy',
  'một',
  'hai',
  'ba',
  'mới',
  'cũ',
  'thật',
  'lạ',
  'quen',
];

const SPANISH_WORDS = [
  'casa',
  'sol',
  'luna',
  'mar',
  'agua',
  'fuego',
  'tierra',
  'cielo',
  'amor',
  'tiempo',
  'vida',
  'mundo',
  'corazón',
  'alma',
  'sueño',
  'fuerza',
  'noche',
  'día',
  'mañana',
  'tarde',
  'invierno',
  'verano',
  'lluvia',
  'viento',
  'pequeño',
  'grande',
  'rápido',
  'lento',
  'feliz',
  'triste',
  'nuevo',
  'viejo',
  'caminar',
  'correr',
  'mirar',
  'sentir',
  'pensar',
  'soñar',
  'reír',
  'llorar',
  'uno',
  'dos',
  'tres',
  'siempre',
  'nunca',
  'aquí',
  'allá',
  'ahora',
];

const HIPSTER_WORDS = [
  'artisan',
  'organic',
  'craft',
  'sustainable',
  'vintage',
  'kombucha',
  'matcha',
  'avocado',
  'thundercats',
  'banjo',
  'mustache',
  'fixie',
  'pour-over',
  'sriracha',
  'kale',
  'quinoa',
  'cardigan',
  'vinyl',
  'cassette',
  'polaroid',
  'film',
  'analog',
  'mixtape',
  'flannel',
  'brooklyn',
  'portland',
  'denim',
  'beard',
  'tattoo',
  'gentrify',
  'farm-to-table',
  'gluten-free',
];

function makeGenerator(variant: LoremVariant): LoremIpsum {
  if (variant === 'vietnamese') return new LoremIpsum({ words: VIETNAMESE_WORDS });
  if (variant === 'spanish') return new LoremIpsum({ words: SPANISH_WORDS });
  if (variant === 'hipster') return new LoremIpsum({ words: HIPSTER_WORDS });
  return new LoremIpsum();
}

const LOREM_PREFIX = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

export function generateLorem(options: LoremOptions = {}): string {
  const variant = options.variant ?? 'classic';
  const unit = options.unit ?? 'paragraphs';
  const count = Math.max(1, Math.min(options.count ?? 3, 500));
  const output = options.output ?? 'plain';
  const startWithLorem = options.startWithLorem ?? (variant === 'classic' && unit === 'paragraphs');

  const gen = makeGenerator(variant);
  let text: string;
  if (unit === 'words') text = gen.generateWords(count);
  else if (unit === 'sentences') text = gen.generateSentences(count);
  else text = gen.generateParagraphs(count);

  if (startWithLorem && unit === 'paragraphs' && variant === 'classic') {
    const firstParagraphEnd = text.indexOf('\n');
    const head = firstParagraphEnd === -1 ? text : text.slice(0, firstParagraphEnd);
    const tail = firstParagraphEnd === -1 ? '' : text.slice(firstParagraphEnd);
    const replaced = `${LOREM_PREFIX} ${head.split('. ').slice(1).join('. ')}`.trim();
    text = `${replaced}${tail}`;
  }

  if (output === 'html') {
    if (unit === 'paragraphs') {
      return text
        .split('\n')
        .filter((p) => p.trim())
        .map((p) => `<p>${p.trim()}</p>`)
        .join('\n');
    }
    return `<p>${text}</p>`;
  }
  return text;
}
