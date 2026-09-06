import type { Tool } from '../types';
import { meta } from './meta';
import { CompressPdfUi } from './ui';

const tool: Tool = { meta, Component: CompressPdfUi };
export default tool;
