import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Pregnancy Due Date Calculator',
  description: "Naegele's rule — last menstrual period + 280 days.",
  lmpLabel: 'First day of last menstrual period',
  lmpAria: 'LMP date',
  row_dueDate: 'Estimated due date',
  row_gestationalAge: 'Gestational age',
  gestationalValue: '{w}w {d}d',
  row_trimester: 'Trimester',
  trimesterValue: 'Trimester {n}',
  row_daysUntil: 'Days until due',
  daysValue: '{n} days',
  pickDate: 'Pick LMP date.',
  disclaimer:
    "For information only. Naegele's rule assumes a 28-day cycle and ovulation on day 14. Ultrasound dating is more accurate. Consult your obstetrician for medical care.",
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tính ngày dự sinh',
    description: 'Quy tắc Naegele — ngày đầu kỳ kinh cuối + 280 ngày.',
    lmpLabel: 'Ngày đầu tiên của kỳ kinh cuối',
    lmpAria: 'Ngày kỳ kinh cuối',
    row_dueDate: 'Ngày dự sinh',
    row_gestationalAge: 'Tuổi thai',
    gestationalValue: '{w} tuần {d} ngày',
    row_trimester: 'Tam cá nguyệt',
    trimesterValue: 'Tam cá nguyệt {n}',
    row_daysUntil: 'Số ngày đến dự sinh',
    daysValue: '{n} ngày',
    pickDate: 'Chọn ngày kỳ kinh cuối.',
    disclaimer:
      'Chỉ để tham khảo. Quy tắc Naegele giả định chu kỳ 28 ngày và rụng trứng ngày 14. Siêu âm cho kết quả chính xác hơn. Hãy khám bác sĩ sản khoa để được chăm sóc y tế.',
  },
  es: {
    title: 'Calculadora de fecha probable de parto',
    description: 'Regla de Naegele: última menstruación + 280 días.',
    lmpLabel: 'Primer día de la última menstruación',
    lmpAria: 'Fecha de la última menstruación',
    row_dueDate: 'Fecha probable de parto',
    row_gestationalAge: 'Edad gestacional',
    gestationalValue: '{w} sem {d} d',
    row_trimester: 'Trimestre',
    trimesterValue: 'Trimestre {n}',
    row_daysUntil: 'Días hasta el parto',
    daysValue: '{n} días',
    pickDate: 'Elige la fecha de la última menstruación.',
    disclaimer:
      'Solo informativo. La regla de Naegele supone un ciclo de 28 días y ovulación el día 14. La datación por ecografía es más precisa. Consulta a tu obstetra para la atención médica.',
  },
  pt: {
    title: 'Calculadora de data provável do parto',
    description: 'Regra de Naegele — última menstruação + 280 dias.',
    lmpLabel: 'Primeiro dia da última menstruação',
    lmpAria: 'Data da última menstruação',
    row_dueDate: 'Data provável do parto',
    row_gestationalAge: 'Idade gestacional',
    gestationalValue: '{w} sem {d} d',
    row_trimester: 'Trimestre',
    trimesterValue: 'Trimestre {n}',
    row_daysUntil: 'Dias até o parto',
    daysValue: '{n} dias',
    pickDate: 'Escolha a data da última menstruação.',
    disclaimer:
      'Apenas informativo. A regra de Naegele pressupõe ciclo de 28 dias e ovulação no dia 14. A datação por ultrassom é mais precisa. Consulte seu obstetra para o acompanhamento médico.',
  },
};
