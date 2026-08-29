import type { Tool } from '../types';
import { meta } from './meta';
import { WcagContrastCheckerUi } from './ui';

const tool: Tool = { meta, Component: WcagContrastCheckerUi };
export default tool;
