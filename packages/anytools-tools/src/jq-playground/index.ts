import type { Tool } from '../types';
import { meta } from './meta';
import { JqPlaygroundUi } from './ui';

const tool: Tool = { meta, Component: JqPlaygroundUi };
export default tool;
