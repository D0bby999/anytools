import type { Tool } from '../types';
import { meta } from './meta';
import { RemoveBackgroundUi } from './ui';

const tool: Tool = { meta, Component: RemoveBackgroundUi };
export default tool;
