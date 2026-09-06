import type { Tool } from '../types';
import { meta } from './meta';
import { SqlPlaygroundUi } from './ui';

const tool: Tool = { meta, Component: SqlPlaygroundUi };
export default tool;
