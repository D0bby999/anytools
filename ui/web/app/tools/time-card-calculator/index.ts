import type { Tool } from '../types';
import { meta } from './meta';
import { TimeCardCalculatorUi } from './ui';

const tool: Tool = { meta, Component: TimeCardCalculatorUi };
export default tool;
