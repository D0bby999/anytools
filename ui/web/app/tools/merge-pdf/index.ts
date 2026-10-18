import type { Tool } from '../types';
import { meta } from './meta';
import { MergePdfUi } from './ui';

const tool: Tool = { meta, Component: MergePdfUi };
export default tool;
