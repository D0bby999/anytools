import type { Tool } from '../types';
import { meta } from './meta';
import { RotatePdfUi } from './ui';

const tool: Tool = { meta, Component: RotatePdfUi };
export default tool;
