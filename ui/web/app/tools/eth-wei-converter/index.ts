import type { Tool } from '../types';
import { meta } from './meta';
import { EthWeiConverterUi } from './ui';

const tool: Tool = { meta, Component: EthWeiConverterUi };
export default tool;
