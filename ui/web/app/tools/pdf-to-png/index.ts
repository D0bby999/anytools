import type { Tool } from '../types';
import { meta } from './meta';
import { PdfToPngUi } from './ui';

const tool: Tool = { meta, Component: PdfToPngUi };
export default tool;
