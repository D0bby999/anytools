import type { Tool } from '../types';
import { meta } from './meta';
import { TotpGeneratorUi } from './ui';

const tool: Tool = { meta, Component: TotpGeneratorUi };
export default tool;
