import type { Tool } from '../types';
import { meta } from './meta';
import { ResizeImageUi } from './ui';

const tool: Tool = { meta, Component: ResizeImageUi };
export default tool;
