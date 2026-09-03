import type { Tool } from '../types';
import { meta } from './meta';
import { OcrPdfUi } from './ui';

const tool: Tool = { meta, Component: OcrPdfUi };
export default tool;
