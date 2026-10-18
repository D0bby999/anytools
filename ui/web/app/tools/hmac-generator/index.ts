import type { Tool } from '../types';
import { meta } from './meta';
import { HmacGeneratorUi } from './ui';

const tool: Tool = { meta, Component: HmacGeneratorUi };
export default tool;
