import type { Tool } from '../types';
import { meta } from './meta';
import { ImageToPdfUi } from './ui';

const tool: Tool = { meta, Component: ImageToPdfUi };
export default tool;
