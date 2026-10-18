import type { Tool } from '../types';
import { meta } from './meta';
import { TipCalculatorUi } from './ui';

const tool: Tool = { meta, Component: TipCalculatorUi };
export default tool;
