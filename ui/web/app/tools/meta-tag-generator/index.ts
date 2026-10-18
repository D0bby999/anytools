import type { Tool } from '../types';
import { meta } from './meta';
import { MetaTagGeneratorUi } from './ui';

const tool: Tool = { meta, Component: MetaTagGeneratorUi };
export default tool;
