import type { Tool } from '../types';
import { meta } from './meta';
import { CurlConverterUi } from './ui';

const tool: Tool = { meta, Component: CurlConverterUi };
export default tool;
