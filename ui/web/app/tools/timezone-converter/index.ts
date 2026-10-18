import type { Tool } from '../types';
import { meta } from './meta';
import { TimezoneConverterUi } from './ui';

const tool: Tool = { meta, Component: TimezoneConverterUi };
export default tool;
