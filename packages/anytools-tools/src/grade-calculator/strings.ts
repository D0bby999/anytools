import type { LocalizedStrings } from '@anytools/ui';

const EN = {
  title: 'Final Grade Calculator',
  description: 'What score do I need on the final to reach my target?',
  currentGrade: 'Current grade',
  targetGrade: 'Target final grade',
  finalWeight: 'Final exam weight',
  scoreNeeded: 'Score needed on final',
  notAchievable: 'Not achievable',
  targetMet: 'Target already met',
  tough: 'Tough',
  achievable: 'Achievable',
  captionAchievable: "If you score {needed}% on the final, you'll end with a {target}% overall.",
  captionImpossible:
    'Even a perfect final cannot reach this target. Consider extra credit options.',
  captionMet: "You've already met or exceeded this target.",
};

export const STRINGS: LocalizedStrings<typeof EN> = {
  en: EN,
  vi: {
    title: 'Tính điểm thi cuối kỳ',
    description: 'Cần bao nhiêu điểm thi cuối kỳ để đạt mục tiêu?',
    currentGrade: 'Điểm hiện tại',
    targetGrade: 'Điểm tổng kết mục tiêu',
    finalWeight: 'Trọng số bài thi cuối kỳ',
    scoreNeeded: 'Điểm cần đạt ở bài thi cuối',
    notAchievable: 'Không thể đạt',
    targetMet: 'Đã đạt mục tiêu',
    tough: 'Khó',
    achievable: 'Khả thi',
    captionAchievable: 'Nếu bạn đạt {needed}% ở bài thi cuối, điểm tổng kết sẽ là {target}%.',
    captionImpossible:
      'Ngay cả bài thi cuối đạt điểm tuyệt đối cũng không tới được mục tiêu này. Hãy cân nhắc điểm cộng thêm.',
    captionMet: 'Bạn đã đạt hoặc vượt mục tiêu này rồi.',
  },
  es: {
    title: 'Calculadora de nota final',
    description: '¿Qué nota necesito en el examen final para alcanzar mi objetivo?',
    currentGrade: 'Nota actual',
    targetGrade: 'Nota final objetivo',
    finalWeight: 'Peso del examen final',
    scoreNeeded: 'Nota necesaria en el final',
    notAchievable: 'No alcanzable',
    targetMet: 'Objetivo ya alcanzado',
    tough: 'Difícil',
    achievable: 'Alcanzable',
    captionAchievable: 'Si sacas {needed}% en el final, terminarás con un {target}% global.',
    captionImpossible:
      'Ni siquiera un final perfecto alcanza este objetivo. Considera opciones de crédito extra.',
    captionMet: 'Ya has alcanzado o superado este objetivo.',
  },
  pt: {
    title: 'Calculadora de nota final',
    description: 'Que nota preciso na prova final para atingir minha meta?',
    currentGrade: 'Nota atual',
    targetGrade: 'Nota final desejada',
    finalWeight: 'Peso da prova final',
    scoreNeeded: 'Nota necessária na final',
    notAchievable: 'Inalcançável',
    targetMet: 'Meta já atingida',
    tough: 'Difícil',
    achievable: 'Alcançável',
    captionAchievable: 'Se você tirar {needed}% na final, terminará com {target}% no total.',
    captionImpossible:
      'Nem uma final perfeita alcança essa meta. Considere opções de crédito extra.',
    captionMet: 'Você já atingiu ou superou essa meta.',
  },
};
