import type { Tool } from '../types';
import { meta } from './meta';
import { GradeCalculatorUi } from './ui';

const tool: Tool = { meta, Component: GradeCalculatorUi };
export default tool;
