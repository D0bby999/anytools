import type { Tool } from '../types';
import { meta } from './meta';
import { JsonDiffUi } from './ui';

const tool: Tool = { meta, Component: JsonDiffUi };
export default tool;
