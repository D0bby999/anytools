import type { Tool } from '../types';
import { meta } from './meta';
import { SleepCalculatorUi } from './ui';

const tool: Tool = { meta, Component: SleepCalculatorUi };
export default tool;
