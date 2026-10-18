import type { Tool } from '../types';
import { meta } from './meta';
import { BmrCalculatorUi } from './ui';

const tool: Tool = { meta, Component: BmrCalculatorUi };
export default tool;
