import type { Tool } from '../types';
import { meta } from './meta';
import { UrlParserUi } from './ui';

const tool: Tool = { meta, Component: UrlParserUi };
export default tool;
