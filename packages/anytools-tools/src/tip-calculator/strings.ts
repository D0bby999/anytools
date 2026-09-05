import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Tip Calculator + Bill Splitter',
  description: 'Add tip percentage and split the total across people.',
  billAmount: 'Bill amount',
  tipPercentage: 'Tip percentage',
  people: 'People',
  row_subtotal: 'Subtotal',
  row_tip: 'Tip ({pct}%)',
  row_total: 'Total',
  row_perPerson: 'Per person (÷{n})',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính tiền tip + chia hóa đơn',
    description: 'Thêm % tiền tip và chia tổng cho số người.',
    billAmount: 'Số tiền hóa đơn',
    tipPercentage: 'Phần trăm tip',
    people: 'Số người',
    row_subtotal: 'Tạm tính',
    row_tip: 'Tip ({pct}%)',
    row_total: 'Tổng',
    row_perPerson: 'Mỗi người (÷{n})',
  },
  es: {
    title: 'Calculadora de propinas + dividir la cuenta',
    description: 'Añade el porcentaje de propina y divide el total entre las personas.',
    billAmount: 'Importe de la cuenta',
    tipPercentage: 'Porcentaje de propina',
    people: 'Personas',
    row_subtotal: 'Subtotal',
    row_tip: 'Propina ({pct} %)',
    row_total: 'Total',
    row_perPerson: 'Por persona (÷{n})',
  },
  pt: {
    title: 'Calculadora de gorjeta + dividir a conta',
    description: 'Adicione a porcentagem de gorjeta e divida o total entre as pessoas.',
    billAmount: 'Valor da conta',
    tipPercentage: 'Porcentagem de gorjeta',
    people: 'Pessoas',
    row_subtotal: 'Subtotal',
    row_tip: 'Gorjeta ({pct}%)',
    row_total: 'Total',
    row_perPerson: 'Por pessoa (÷{n})',
  },
};
