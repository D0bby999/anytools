import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Currency Converter',
  loadingRates: 'Loading rates…',
  ratesFrom: 'Rates from {date} (Frankfurter / ECB). Updated daily.',
  ratesUnavailable: 'Rates unavailable. Refresh to retry.',
  fromCurrency: 'Source currency',
  toCurrency: 'Target currency',
  fromAmount: 'Amount to convert',
  toAmount: 'Converted amount',
  rateNote: '1 {from} = {rate} {to}. Indicative rate; banks/brokers add spreads.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Chuyển đổi tiền tệ',
    loadingRates: 'Đang tải tỷ giá…',
    ratesFrom: 'Tỷ giá ngày {date} (Frankfurter / ECB). Cập nhật hằng ngày.',
    ratesUnavailable: 'Không lấy được tỷ giá. Tải lại trang để thử lại.',
    fromCurrency: 'Tiền tệ nguồn',
    toCurrency: 'Tiền tệ đích',
    fromAmount: 'Số tiền cần đổi',
    toAmount: 'Số tiền sau quy đổi',
    rateNote: '1 {from} = {rate} {to}. Tỷ giá tham khảo; ngân hàng/sàn cộng thêm chênh lệch.',
  },
  es: {
    title: 'Conversor de divisas',
    loadingRates: 'Cargando tipos de cambio…',
    ratesFrom: 'Tipos del {date} (Frankfurter / BCE). Actualizados a diario.',
    ratesUnavailable: 'Tipos de cambio no disponibles. Recarga para reintentar.',
    fromCurrency: 'Moneda de origen',
    toCurrency: 'Moneda de destino',
    fromAmount: 'Importe a convertir',
    toAmount: 'Importe convertido',
    rateNote: '1 {from} = {rate} {to}. Tipo indicativo; bancos y brókeres añaden un margen.',
  },
  pt: {
    title: 'Conversor de moedas',
    loadingRates: 'Carregando cotações…',
    ratesFrom: 'Cotações de {date} (Frankfurter / BCE). Atualizadas diariamente.',
    ratesUnavailable: 'Cotações indisponíveis. Recarregue para tentar de novo.',
    fromCurrency: 'Moeda de origem',
    toCurrency: 'Moeda de destino',
    fromAmount: 'Valor a converter',
    toAmount: 'Valor convertido',
    rateNote: '1 {from} = {rate} {to}. Cotação indicativa; bancos e corretoras cobram spread.',
  },
};
