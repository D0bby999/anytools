import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'BMI Calculator',
  description: 'Body Mass Index with WHO category. Metric or imperial.',
  yourBmi: 'Your BMI',
  caption: 'WHO 1995 ranges. Asian-Pacific population may use 23 / 27.5 cutoffs.',
  disclaimer:
    'For estimation only. BMI does not distinguish muscle from fat; athletes, pregnant people, children and the elderly need different assessment. Consult a clinician for medical decisions.',
  cat_underweight: 'Underweight',
  cat_normal: 'Normal',
  cat_overweight: 'Overweight',
  cat_obese1: 'Obesity class I',
  cat_obese2: 'Obesity class II',
  cat_obese3: 'Obesity class III',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính BMI',
    description: 'Chỉ số khối cơ thể kèm phân loại theo WHO. Hệ mét hoặc hệ Anh.',
    yourBmi: 'BMI của bạn',
    caption: 'Ngưỡng WHO 1995. Người châu Á – Thái Bình Dương có thể dùng ngưỡng 23 / 27,5.',
    disclaimer:
      'Chỉ mang tính ước lượng. BMI không phân biệt cơ và mỡ; vận động viên, phụ nữ mang thai, trẻ em và người cao tuổi cần cách đánh giá khác. Hãy hỏi bác sĩ trước khi ra quyết định y tế.',
    cat_underweight: 'Thiếu cân',
    cat_normal: 'Bình thường',
    cat_overweight: 'Thừa cân',
    cat_obese1: 'Béo phì độ I',
    cat_obese2: 'Béo phì độ II',
    cat_obese3: 'Béo phì độ III',
  },
  es: {
    title: 'Calculadora de IMC',
    description: 'Índice de masa corporal con categoría de la OMS. Sistema métrico o imperial.',
    yourBmi: 'Tu IMC',
    caption:
      'Rangos de la OMS de 1995. La población de Asia-Pacífico puede usar los cortes 23 / 27,5.',
    disclaimer:
      'Solo para estimación. El IMC no distingue músculo de grasa; deportistas, personas embarazadas, niños y personas mayores necesitan otra evaluación. Consulta a un profesional sanitario para decisiones médicas.',
    cat_underweight: 'Bajo peso',
    cat_normal: 'Normal',
    cat_overweight: 'Sobrepeso',
    cat_obese1: 'Obesidad clase I',
    cat_obese2: 'Obesidad clase II',
    cat_obese3: 'Obesidad clase III',
  },
  pt: {
    title: 'Calculadora de IMC',
    description: 'Índice de massa corporal com categoria da OMS. Sistema métrico ou imperial.',
    yourBmi: 'Seu IMC',
    caption: 'Faixas da OMS de 1995. A população da Ásia-Pacífico pode usar os cortes 23 / 27,5.',
    disclaimer:
      'Apenas para estimativa. O IMC não distingue músculo de gordura; atletas, gestantes, crianças e idosos precisam de outra avaliação. Consulte um médico para decisões de saúde.',
    cat_underweight: 'Abaixo do peso',
    cat_normal: 'Normal',
    cat_overweight: 'Sobrepeso',
    cat_obese1: 'Obesidade grau I',
    cat_obese2: 'Obesidade grau II',
    cat_obese3: 'Obesidade grau III',
  },
};
