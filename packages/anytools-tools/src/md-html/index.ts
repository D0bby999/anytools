import type { Tool } from '../types';
import { meta } from './meta';
import { MdHtmlUi } from './ui';

const tool: Tool = { meta, Component: MdHtmlUi };
export default tool;
