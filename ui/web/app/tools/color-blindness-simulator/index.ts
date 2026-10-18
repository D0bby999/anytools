import type { Tool } from '../types';
import { meta } from './meta';
import { ColorBlindnessSimulatorUi } from './ui';

const tool: Tool = { meta, Component: ColorBlindnessSimulatorUi };
export default tool;
