import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Compound Interest Calculator',
  description: 'Annual rate, compounded monthly, monthly contributions.',
  initialPrincipal: 'Initial principal',
  monthlyContribution: 'Monthly contribution',
  annualRate: 'Annual interest rate',
  years: 'Years',
  unitYears: 'yrs',
  row_finalBalance: 'Final balance',
  row_totalContributed: 'Total contributed',
  row_interestEarned: 'Interest earned',
  disclaimer:
    'Estimation only. Real returns vary with market conditions, taxes, and fees. Past performance does not guarantee future results.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính lãi kép',
    description: 'Lãi suất năm, ghép lãi hằng tháng, đóng góp hằng tháng.',
    initialPrincipal: 'Vốn ban đầu',
    monthlyContribution: 'Đóng góp hằng tháng',
    annualRate: 'Lãi suất năm',
    years: 'Số năm',
    unitYears: 'năm',
    row_finalBalance: 'Số dư cuối kỳ',
    row_totalContributed: 'Tổng tiền đã góp',
    row_interestEarned: 'Tiền lãi nhận được',
    disclaimer:
      'Chỉ mang tính ước lượng. Lợi nhuận thực tế phụ thuộc thị trường, thuế và phí. Kết quả quá khứ không đảm bảo kết quả tương lai.',
  },
  es: {
    title: 'Calculadora de interés compuesto',
    description: 'Tasa anual, capitalización mensual, aportaciones mensuales.',
    initialPrincipal: 'Capital inicial',
    monthlyContribution: 'Aportación mensual',
    annualRate: 'Tasa de interés anual',
    years: 'Años',
    unitYears: 'años',
    row_finalBalance: 'Saldo final',
    row_totalContributed: 'Total aportado',
    row_interestEarned: 'Intereses ganados',
    disclaimer:
      'Solo estimación. La rentabilidad real varía con el mercado, los impuestos y las comisiones. Rendimientos pasados no garantizan resultados futuros.',
  },
  pt: {
    title: 'Calculadora de juros compostos',
    description: 'Taxa anual, capitalização mensal, aportes mensais.',
    initialPrincipal: 'Capital inicial',
    monthlyContribution: 'Aporte mensal',
    annualRate: 'Taxa de juros anual',
    years: 'Anos',
    unitYears: 'anos',
    row_finalBalance: 'Saldo final',
    row_totalContributed: 'Total aportado',
    row_interestEarned: 'Juros ganhos',
    disclaimer:
      'Apenas estimativa. Os retornos reais variam com o mercado, impostos e taxas. Desempenho passado não garante resultados futuros.',
  },
};
