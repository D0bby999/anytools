import type { Tool } from '../types';
import { meta } from './meta';
import { MortgageCalculatorUi } from './ui';

const tool: Tool = { meta, Component: MortgageCalculatorUi };
export default tool;
