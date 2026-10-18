import type { Tool } from '../types';
import { meta } from './meta';
import { PaceCalculatorUi } from './ui';

const tool: Tool = { meta, Component: PaceCalculatorUi };
export default tool;
