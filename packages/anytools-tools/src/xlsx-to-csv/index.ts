import type { Tool } from '../types';
import { meta } from './meta';
import { XlsxToCsvUi } from './ui';

const tool: Tool = { meta, Component: XlsxToCsvUi };
export default tool;
