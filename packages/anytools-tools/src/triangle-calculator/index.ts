import type { Tool } from '../types';
import { meta } from './meta';
import { TriangleCalculatorUi } from './ui';

const tool: Tool = { meta, Component: TriangleCalculatorUi };
export default tool;
