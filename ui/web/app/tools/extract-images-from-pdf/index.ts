import type { Tool } from '../types';
import { meta } from './meta';
import { ExtractImagesFromPdfUi } from './ui';

const tool: Tool = { meta, Component: ExtractImagesFromPdfUi };
export default tool;
