import type { Tool } from '../types';
import { meta } from './meta';
import { HeicToJpgUi } from './ui';

const tool: Tool = { meta, Component: HeicToJpgUi };
export default tool;
