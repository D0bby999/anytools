import type { Tool } from '../types';
import { meta } from './meta';
import { BinaryEncodeUi } from './ui';

const tool: Tool = { meta, Component: BinaryEncodeUi };
export default tool;
