import type { Tool } from '../types';
import { meta } from './meta';
import { PdfPasswordUi } from './ui';

const tool: Tool = { meta, Component: PdfPasswordUi };
export default tool;
