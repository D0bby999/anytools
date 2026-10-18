import type { Tool } from '../types';
import { meta } from './meta';
import { OcrImageToTextUi } from './ui';

const tool: Tool = { meta, Component: OcrImageToTextUi };
export default tool;
