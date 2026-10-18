import type { Tool } from '../types';
import { meta } from './meta';
import { ChmodCalculatorUi } from './ui';

const tool: Tool = { meta, Component: ChmodCalculatorUi };
export default tool;
