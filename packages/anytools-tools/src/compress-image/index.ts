import type { Tool } from '../types';
import { meta } from './meta';
import { CompressImageUi } from './ui';

const tool: Tool = { meta, Component: CompressImageUi };
export default tool;
