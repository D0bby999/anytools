import type { Tool } from '../types';
import { meta } from './meta';
import { JsonYamlTomlUi } from './ui';

const tool: Tool = { meta, Component: JsonYamlTomlUi };
export default tool;
