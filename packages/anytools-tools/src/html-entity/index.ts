import type { Tool } from '../types';
import { meta } from './meta';
import { HtmlEntityUi } from './ui';

const tool: Tool = { meta, Component: HtmlEntityUi };
export default tool;
