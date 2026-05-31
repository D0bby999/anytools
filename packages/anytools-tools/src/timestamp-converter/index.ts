import type { Tool } from '../types';
import { meta } from './meta';
import { TimestampConverterUi } from './ui';

const tool: Tool = { meta, Component: TimestampConverterUi };
export default tool;
