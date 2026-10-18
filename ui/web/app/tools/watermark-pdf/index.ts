import type { Tool } from '../types';
import { meta } from './meta';
import { WatermarkPdfUi } from './ui';

const tool: Tool = { meta, Component: WatermarkPdfUi };
export default tool;
