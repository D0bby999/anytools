import type { Tool } from '../types';
import { meta } from './meta';
import { BmiCalculatorUi } from './ui';

const tool: Tool = {
  meta,
  Component: BmiCalculatorUi,
};

export default tool;
