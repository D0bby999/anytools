import {
  camelCase,
  capitalCase,
  constantCase,
  dotCase,
  kebabCase,
  noCase,
  pascalCase,
  pascalSnakeCase,
  pathCase,
  sentenceCase,
  snakeCase,
  trainCase,
} from 'change-case';

export type CaseType =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'kebab'
  | 'constant'
  | 'dot'
  | 'path'
  | 'sentence'
  | 'capital'
  | 'no'
  | 'train'
  | 'pascalSnake'
  | 'upper'
  | 'lower';

const CONVERTERS: Record<CaseType, (s: string) => string> = {
  camel: camelCase,
  pascal: pascalCase,
  snake: snakeCase,
  kebab: kebabCase,
  constant: constantCase,
  dot: dotCase,
  path: pathCase,
  sentence: sentenceCase,
  capital: capitalCase,
  no: noCase,
  train: trainCase,
  pascalSnake: pascalSnakeCase,
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
};

export function convertCase(text: string, target: CaseType): string {
  return CONVERTERS[target](text);
}

export function convertAllCases(text: string): Record<CaseType, string> {
  const out = {} as Record<CaseType, string>;
  for (const type of Object.keys(CONVERTERS) as CaseType[]) {
    out[type] = CONVERTERS[type](text);
  }
  return out;
}
