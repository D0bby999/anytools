import type { Tool } from '../types';
import { meta } from './meta';
import { SqlFormatterUi } from './ui';

const tool: Tool = { meta, Component: SqlFormatterUi };
export default tool;
