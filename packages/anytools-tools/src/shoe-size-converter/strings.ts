import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Shoe Size Converter',
  description: 'Approximate. Brand sizing varies — when in doubt, measure your foot.',
  demographic: 'Demographic',
  men: 'Men',
  women: 'Women',
  inputSystem: 'Input system',
  size: 'Size ({system})',
  sizeValue: 'Size value',
  equivalent: 'Equivalent ({demo})',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi cỡ giày',
    description: 'Chỉ mang tính tương đối. Mỗi hãng một cỡ — nếu không chắc, hãy đo bàn chân.',
    demographic: 'Đối tượng',
    men: 'Nam',
    women: 'Nữ',
    inputSystem: 'Hệ cỡ đầu vào',
    size: 'Cỡ ({system})',
    sizeValue: 'Giá trị cỡ giày',
    equivalent: 'Cỡ tương đương ({demo})',
  },
  es: {
    title: 'Conversor de tallas de calzado',
    description: 'Aproximado. Cada marca talla distinto: ante la duda, mide tu pie.',
    demographic: 'Grupo',
    men: 'Hombre',
    women: 'Mujer',
    inputSystem: 'Sistema de entrada',
    size: 'Talla ({system})',
    sizeValue: 'Valor de la talla',
    equivalent: 'Equivalente ({demo})',
  },
  pt: {
    title: 'Conversor de tamanho de calçado',
    description: 'Aproximado. Cada marca varia: na dúvida, meça seu pé.',
    demographic: 'Grupo',
    men: 'Masculino',
    women: 'Feminino',
    inputSystem: 'Sistema de entrada',
    size: 'Tamanho ({system})',
    sizeValue: 'Valor do tamanho',
    equivalent: 'Equivalente ({demo})',
  },
};
