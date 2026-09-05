import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Body Fat % Calculator',
  description: 'US Navy method (Hodgdon-Beckett). Estimate without calipers or DEXA.',
  sexLabel: 'Sex (biological)',
  male: 'Male',
  female: 'Female',
  waist: 'Waist',
  neck: 'Neck',
  hip: 'Hip',
  outOfRange: 'Inputs out of range. Waist must be larger than neck.',
  bodyFat: 'Body fat',
  caption:
    'US Navy method has ±3-4% accuracy vs DEXA. Best for trend tracking, not single-point precision.',
  disclaimer:
    'Estimation only. For accurate body composition use DEXA, BodPod, or calibrated calipers.',
  cat_essential: 'Essential fat',
  cat_athletic: 'Athletic',
  cat_fitness: 'Fitness',
  cat_average: 'Average',
  cat_high: 'High',
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Máy tính % mỡ cơ thể',
    description: 'Phương pháp Hải quân Mỹ (Hodgdon-Beckett). Ước lượng không cần kẹp đo hay DEXA.',
    sexLabel: 'Giới tính (sinh học)',
    male: 'Nam',
    female: 'Nữ',
    waist: 'Vòng eo',
    neck: 'Vòng cổ',
    hip: 'Vòng hông',
    outOfRange: 'Số liệu ngoài phạm vi. Vòng eo phải lớn hơn vòng cổ.',
    bodyFat: 'Mỡ cơ thể',
    caption:
      'Phương pháp Hải quân Mỹ sai lệch ±3-4% so với DEXA. Hợp để theo dõi xu hướng, không phải đo chính xác một lần.',
    disclaimer:
      'Chỉ mang tính ước lượng. Muốn đo thành phần cơ thể chính xác, hãy dùng DEXA, BodPod hoặc kẹp đo đã hiệu chuẩn.',
    cat_essential: 'Mỡ thiết yếu',
    cat_athletic: 'Vận động viên',
    cat_fitness: 'Thể hình tốt',
    cat_average: 'Trung bình',
    cat_high: 'Cao',
  },
  es: {
    title: 'Calculadora de % de grasa corporal',
    description:
      'Método de la Marina de EE. UU. (Hodgdon-Beckett). Estima sin calibradores ni DEXA.',
    sexLabel: 'Sexo (biológico)',
    male: 'Hombre',
    female: 'Mujer',
    waist: 'Cintura',
    neck: 'Cuello',
    hip: 'Cadera',
    outOfRange: 'Valores fuera de rango. La cintura debe ser mayor que el cuello.',
    bodyFat: 'Grasa corporal',
    caption:
      'El método de la Marina tiene una precisión de ±3-4 % frente a DEXA. Mejor para seguir tendencias, no para una medida puntual exacta.',
    disclaimer:
      'Solo estimación. Para una composición corporal precisa usa DEXA, BodPod o calibradores calibrados.',
    cat_essential: 'Grasa esencial',
    cat_athletic: 'Atlético',
    cat_fitness: 'En forma',
    cat_average: 'Promedio',
    cat_high: 'Alto',
  },
  pt: {
    title: 'Calculadora de % de gordura corporal',
    description: 'Método da Marinha dos EUA (Hodgdon-Beckett). Estimativa sem adipômetro nem DEXA.',
    sexLabel: 'Sexo (biológico)',
    male: 'Masculino',
    female: 'Feminino',
    waist: 'Cintura',
    neck: 'Pescoço',
    hip: 'Quadril',
    outOfRange: 'Valores fora da faixa. A cintura deve ser maior que o pescoço.',
    bodyFat: 'Gordura corporal',
    caption:
      'O método da Marinha tem precisão de ±3-4% em relação ao DEXA. Bom para acompanhar tendências, não para uma medição pontual exata.',
    disclaimer:
      'Apenas estimativa. Para uma composição corporal precisa use DEXA, BodPod ou adipômetro calibrado.',
    cat_essential: 'Gordura essencial',
    cat_athletic: 'Atlético',
    cat_fitness: 'Em forma',
    cat_average: 'Médio',
    cat_high: 'Alto',
  },
};
