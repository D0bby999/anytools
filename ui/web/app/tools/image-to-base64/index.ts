import type { Tool } from '../types';
import { meta } from './meta';
import { ImageToBase64Ui } from './ui';

const tool: Tool = { meta, Component: ImageToBase64Ui };
export default tool;
