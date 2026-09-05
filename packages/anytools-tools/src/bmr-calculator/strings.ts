import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'BMR Calculator',
  description: 'Mifflin–St Jeor — calories burned at rest.',
  sexLabel: 'Sex (biological)',
  male: 'Male',
  female: 'Female',
  age: 'Age',
  unitYears: 'yrs',
  yourBmr: 'Your BMR',
  unitKcalDay: 'kcal/day',
  caption: 'Calories your body burns at complete rest. Multiply by activity factor for TDEE.',
  disclaimer:
    'Estimation only. ±10% accuracy. Real metabolic rates vary with thyroid status, body composition, and recent diet.',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính BMR',
    description: 'Mifflin–St Jeor — lượng calo đốt khi nghỉ ngơi.',
    sexLabel: 'Giới tính (sinh học)',
    male: 'Nam',
    female: 'Nữ',
    age: 'Tuổi',
    unitYears: 'tuổi',
    yourBmr: 'BMR của bạn',
    unitKcalDay: 'kcal/ngày',
    caption: 'Lượng calo cơ thể đốt khi nghỉ ngơi hoàn toàn. Nhân với hệ số vận động để ra TDEE.',
    disclaimer:
      'Chỉ mang tính ước lượng. Độ chính xác ±10%. Tốc độ trao đổi chất thực tế phụ thuộc tuyến giáp, thành phần cơ thể và chế độ ăn gần đây.',
  },
  es: {
    title: 'Calculadora de TMB',
    description: 'Mifflin–St Jeor: calorías quemadas en reposo.',
    sexLabel: 'Sexo (biológico)',
    male: 'Hombre',
    female: 'Mujer',
    age: 'Edad',
    unitYears: 'años',
    yourBmr: 'Tu TMB',
    unitKcalDay: 'kcal/día',
    caption:
      'Calorías que tu cuerpo quema en reposo absoluto. Multiplica por el factor de actividad para obtener el TDEE.',
    disclaimer:
      'Solo estimación. Precisión de ±10 %. La tasa metabólica real varía según la tiroides, la composición corporal y la dieta reciente.',
  },
  pt: {
    title: 'Calculadora de TMB',
    description: 'Mifflin–St Jeor — calorias gastas em repouso.',
    sexLabel: 'Sexo (biológico)',
    male: 'Masculino',
    female: 'Feminino',
    age: 'Idade',
    unitYears: 'anos',
    yourBmr: 'Sua TMB',
    unitKcalDay: 'kcal/dia',
    caption:
      'Calorias que seu corpo gasta em repouso total. Multiplique pelo fator de atividade para obter o TDEE.',
    disclaimer:
      'Apenas estimativa. Precisão de ±10%. A taxa metabólica real varia com a tireoide, a composição corporal e a dieta recente.',
  },
};
