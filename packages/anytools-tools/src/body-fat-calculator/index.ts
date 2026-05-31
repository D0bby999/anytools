import type { Tool } from '../types';
import { meta } from './meta';
import { BodyFatCalculatorUi } from './ui';

const tool: Tool = { meta, Component: BodyFatCalculatorUi };
export default tool;
