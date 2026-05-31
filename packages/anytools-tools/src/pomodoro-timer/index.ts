import type { Tool } from '../types';
import { meta } from './meta';
import { PomodoroTimerUi } from './ui';

const tool: Tool = { meta, Component: PomodoroTimerUi };
export default tool;
