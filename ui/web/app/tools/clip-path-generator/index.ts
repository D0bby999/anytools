import type { Tool } from '../types';
import { meta } from './meta';
import { ClipPathGeneratorUi } from './ui';

const tool: Tool = { meta, Component: ClipPathGeneratorUi };
export default tool;
