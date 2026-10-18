import type { Tool } from '../types';
import { meta } from './meta';
import { GpaCalculatorUi } from './ui';

const tool: Tool = { meta, Component: GpaCalculatorUi };
export default tool;
