import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Scientific Calculator',
  description:
    'Functions: sin, cos, tan, asin, acos, atan, log (base 10), ln, sqrt, exp, abs, !, ^. Constants: pi, e.',
  placeholder: 'e.g. sin(pi/4) + sqrt(16)',
  expression: 'Expression',
  backspace: 'Backspace',
  error: 'Error',
  syntaxError: 'Syntax error',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính khoa học',
    description:
      'Hàm: sin, cos, tan, asin, acos, atan, log (cơ số 10), ln, sqrt, exp, abs, !, ^. Hằng số: pi, e.',
    placeholder: 'vd: sin(pi/4) + sqrt(16)',
    expression: 'Biểu thức',
    backspace: 'Xóa lùi',
    error: 'Lỗi',
    syntaxError: 'Lỗi cú pháp',
  },
  es: {
    title: 'Calculadora científica',
    description:
      'Funciones: sin, cos, tan, asin, acos, atan, log (base 10), ln, sqrt, exp, abs, !, ^. Constantes: pi, e.',
    placeholder: 'p. ej. sin(pi/4) + sqrt(16)',
    expression: 'Expresión',
    backspace: 'Retroceso',
    error: 'Error',
    syntaxError: 'Error de sintaxis',
  },
  pt: {
    title: 'Calculadora científica',
    description:
      'Funções: sin, cos, tan, asin, acos, atan, log (base 10), ln, sqrt, exp, abs, !, ^. Constantes: pi, e.',
    placeholder: 'ex.: sin(pi/4) + sqrt(16)',
    expression: 'Expressão',
    backspace: 'Apagar',
    error: 'Erro',
    syntaxError: 'Erro de sintaxe',
  },
};
