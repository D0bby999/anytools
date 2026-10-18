import type { Tool } from '../types';
import { meta } from './meta';
import { JsonFormatterUi } from './ui';

const tool: Tool = { meta, Component: JsonFormatterUi };
export default tool;
