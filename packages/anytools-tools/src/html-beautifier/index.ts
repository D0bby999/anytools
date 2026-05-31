import type { Tool } from '../types';
import { meta } from './meta';
import { HtmlBeautifierUi } from './ui';

const tool: Tool = { meta, Component: HtmlBeautifierUi };
export default tool;
