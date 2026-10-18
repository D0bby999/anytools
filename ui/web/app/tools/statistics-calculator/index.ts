import type { Tool } from '../types';
import { meta } from './meta';
import { StatisticsCalculatorUi } from './ui';

const tool: Tool = { meta, Component: StatisticsCalculatorUi };
export default tool;
