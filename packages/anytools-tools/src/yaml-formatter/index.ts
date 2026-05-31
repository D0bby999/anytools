import type { Tool } from '../types';
import { meta } from './meta';
import { YamlFormatterUi } from './ui';

const tool: Tool = { meta, Component: YamlFormatterUi };
export default tool;
