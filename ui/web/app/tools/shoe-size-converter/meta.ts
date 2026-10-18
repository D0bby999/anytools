import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'shoe-size-converter',
  cluster: 'lifestyle',
  title: {
    en: 'Shoe Size Converter — US / EU / UK / JP',
    vi: 'Đổi size giày — US / EU / UK / JP',
    es: 'Conversor de talla de calzado — US / EU / UK / JP',
    pt: 'Conversor de tamanho de calçado — US / EU / UK / JP',
  },
  description: {
    en: 'Convert shoe sizes across US, EU, UK, and JP (cm). Men, women, kids. Approximate — brands vary.',
    vi: 'Đổi size giày giữa US, EU, UK, JP (cm). Nam, nữ, trẻ em. Xấp xỉ — brands khác nhau.',
    es: 'Convierte tallas de calzado entre US, EU, UK y JP. Hombre, mujer, niños.',
    pt: 'Converta tamanhos de calçado entre US, EU, UK e JP. Homem, mulher, criança.',
  },
  keywords: [
    'shoe size converter',
    'us eu uk shoe size',
    'shoe size chart',
    'size giày',
    'talla calzado',
  ],
  priority: 'P3',
  effort: 'S',
  published: true,
};
