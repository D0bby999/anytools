import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Loan Calculator',
  description: 'Auto, personal, student. Monthly payment + total interest.',
  loanAmount: 'Loan amount',
  annualRate: 'Annual interest rate',
  term: 'Term',
  unitMonths: 'mo',
  row_monthly: 'Monthly payment',
  row_totalInterest: 'Total interest',
  row_totalPaid: 'Total paid',
  row_term: 'Term',
  termValue: '{months} months ({years} yr)',
  disclaimer:
    'Estimation only. Real loan terms include origination fees and may use different compounding.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính khoản vay',
    description: 'Vay mua xe, tiêu dùng, học phí. Trả hằng tháng + tổng lãi.',
    loanAmount: 'Số tiền vay',
    annualRate: 'Lãi suất năm',
    term: 'Kỳ hạn',
    unitMonths: 'tháng',
    row_monthly: 'Trả hằng tháng',
    row_totalInterest: 'Tổng lãi',
    row_totalPaid: 'Tổng phải trả',
    row_term: 'Kỳ hạn',
    termValue: '{months} tháng ({years} năm)',
    disclaimer:
      'Chỉ mang tính ước lượng. Khoản vay thực tế có phí giải ngân và có thể tính lãi theo cách khác.',
  },
  es: {
    title: 'Calculadora de préstamos',
    description: 'Coche, personal, estudios. Cuota mensual + intereses totales.',
    loanAmount: 'Importe del préstamo',
    annualRate: 'Tasa de interés anual',
    term: 'Plazo',
    unitMonths: 'meses',
    row_monthly: 'Cuota mensual',
    row_totalInterest: 'Intereses totales',
    row_totalPaid: 'Total pagado',
    row_term: 'Plazo',
    termValue: '{months} meses ({years} años)',
    disclaimer:
      'Solo estimación. Los préstamos reales incluyen comisiones de apertura y pueden usar otra capitalización.',
  },
  pt: {
    title: 'Calculadora de empréstimo',
    description: 'Veículo, pessoal, estudantil. Parcela mensal + juros totais.',
    loanAmount: 'Valor do empréstimo',
    annualRate: 'Taxa de juros anual',
    term: 'Prazo',
    unitMonths: 'meses',
    row_monthly: 'Parcela mensal',
    row_totalInterest: 'Juros totais',
    row_totalPaid: 'Total pago',
    row_term: 'Prazo',
    termValue: '{months} meses ({years} anos)',
    disclaimer:
      'Apenas estimativa. Empréstimos reais incluem taxas de abertura e podem usar outra capitalização.',
  },
};
