import type { Tool } from '../types';
import { meta } from './meta';
import { DocxToMarkdownUi } from './ui';

const tool: Tool = { meta, Component: DocxToMarkdownUi };
export default tool;
