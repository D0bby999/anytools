import type { Tool } from '../types';
import { meta } from './meta';
import { UnitConverterUi } from './ui';

const tool: Tool = { meta, Component: UnitConverterUi };
export default tool;
