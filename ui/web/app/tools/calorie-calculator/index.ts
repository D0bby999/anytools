import type { Tool } from '../types';
import { meta } from './meta';
import { CalorieCalculatorUi } from './ui';

const tool: Tool = { meta, Component: CalorieCalculatorUi };
export default tool;
