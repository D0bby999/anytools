import type { Tool } from '../types';
import { meta } from './meta';
import { XmlFormatterUi } from './ui';

const tool: Tool = { meta, Component: XmlFormatterUi };
export default tool;
