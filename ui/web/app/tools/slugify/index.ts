import type { Tool } from '../types';
import { meta } from './meta';
import { SlugifyUi } from './ui';

const tool: Tool = { meta, Component: SlugifyUi };
export default tool;
