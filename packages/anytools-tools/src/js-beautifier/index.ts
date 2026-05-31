import type { Tool } from '../types';
import { meta } from './meta';
import { JsBeautifierUi } from './ui';

const tool: Tool = { meta, Component: JsBeautifierUi };
export default tool;
