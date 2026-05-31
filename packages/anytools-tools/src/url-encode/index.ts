import type { Tool } from '../types';
import { meta } from './meta';
import { UrlEncodeUi } from './ui';

const tool: Tool = { meta, Component: UrlEncodeUi };
export default tool;
