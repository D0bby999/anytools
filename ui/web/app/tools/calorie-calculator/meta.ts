import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'calorie-calculator',
  cluster: 'health',
  title: {
    en: 'Calorie & TDEE Calculator',
    vi: 'Tính calo & TDEE',
    es: 'Calculadora de calorías y TDEE',
    pt: 'Calculadora de calorias e TDEE',
  },
  description: {
    en: 'Daily calorie target calculator. BMR (Mifflin–St Jeor) × activity factor × goal adjustment. Returns TDEE and weight goal calories.',
    vi: 'Tính calo target hàng ngày. BMR × activity factor × điều chỉnh mục tiêu. Trả về TDEE và calo theo mục tiêu cân.',
    es: 'Calculadora de calorías diarias. BMR × factor de actividad × ajuste de meta. Devuelve TDEE y calorías por meta.',
    pt: 'Calculadora de calorias diárias. BMR × fator de atividade × ajuste de meta. Devolve TDEE e calorias por meta.',
  },
  keywords: [
    'calorie calculator',
    'tdee',
    'maintenance calories',
    'weight loss calories',
    'tính calo',
    'mifflin st jeor',
  ],
  priority: 'P2',
  effort: 'M',
  published: true,
};
