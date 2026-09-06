import type { Tool } from '../types';
import { meta } from './meta';
import { CubicBezierGeneratorUi } from './ui';

const tool: Tool = { meta, Component: CubicBezierGeneratorUi };
export default tool;
