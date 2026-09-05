import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Mortgage Calculator',
  description: 'Monthly payment + total interest. User-input rate.',
  homePrice: 'Home price',
  downPayment: 'Down payment',
  interestRate: 'Interest rate',
  loanTerm: 'Loan term',
  unitYears: 'yrs',
  row_loanAmount: 'Loan amount',
  row_monthly: 'Monthly payment',
  row_totalInterest: 'Total interest',
  row_totalPaid: 'Total paid',
  disclaimer:
    'Estimation only. Does not include property tax, PMI, HOA, or insurance. Consult a lender for accurate quotes.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính vay mua nhà',
    description: 'Trả hằng tháng + tổng lãi. Lãi suất do bạn nhập.',
    homePrice: 'Giá nhà',
    downPayment: 'Tiền trả trước',
    interestRate: 'Lãi suất',
    loanTerm: 'Thời hạn vay',
    unitYears: 'năm',
    row_loanAmount: 'Số tiền vay',
    row_monthly: 'Trả hằng tháng',
    row_totalInterest: 'Tổng lãi',
    row_totalPaid: 'Tổng phải trả',
    disclaimer:
      'Chỉ mang tính ước lượng. Chưa gồm thuế bất động sản, PMI, phí HOA hay bảo hiểm. Hãy hỏi bên cho vay để có báo giá chính xác.',
  },
  es: {
    title: 'Calculadora de hipoteca',
    description: 'Cuota mensual + intereses totales. Tasa introducida por ti.',
    homePrice: 'Precio de la vivienda',
    downPayment: 'Entrada',
    interestRate: 'Tasa de interés',
    loanTerm: 'Plazo del préstamo',
    unitYears: 'años',
    row_loanAmount: 'Importe del préstamo',
    row_monthly: 'Cuota mensual',
    row_totalInterest: 'Intereses totales',
    row_totalPaid: 'Total pagado',
    disclaimer:
      'Solo estimación. No incluye impuesto sobre bienes inmuebles, PMI, cuotas de comunidad ni seguro. Consulta a una entidad para una oferta exacta.',
  },
  pt: {
    title: 'Calculadora de financiamento imobiliário',
    description: 'Parcela mensal + juros totais. Taxa informada por você.',
    homePrice: 'Preço do imóvel',
    downPayment: 'Entrada',
    interestRate: 'Taxa de juros',
    loanTerm: 'Prazo do financiamento',
    unitYears: 'anos',
    row_loanAmount: 'Valor financiado',
    row_monthly: 'Parcela mensal',
    row_totalInterest: 'Juros totais',
    row_totalPaid: 'Total pago',
    disclaimer:
      'Apenas estimativa. Não inclui IPTU, PMI, condomínio nem seguro. Consulte um banco para uma cotação exata.',
  },
};
