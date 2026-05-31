import type { Tool } from '../types';
import { meta } from './meta';
import { LoanCalculatorUi } from './ui';

const tool: Tool = { meta, Component: LoanCalculatorUi };
export default tool;
