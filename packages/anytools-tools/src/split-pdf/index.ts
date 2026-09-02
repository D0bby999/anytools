import type { Tool } from '../types';
import { meta } from './meta';
import { SplitPdfUi } from './ui';

const tool: Tool = { meta, Component: SplitPdfUi };
export default tool;
