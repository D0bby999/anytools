import type { Tool } from '../types';
import { meta } from './meta';
import { CssBeautifierUi } from './ui';

const tool: Tool = { meta, Component: CssBeautifierUi };
export default tool;
