import type { Tool } from '../types';
import { meta } from './meta';
import { AgeCalculatorUi } from './ui';

const tool: Tool = { meta, Component: AgeCalculatorUi };
export default tool;
