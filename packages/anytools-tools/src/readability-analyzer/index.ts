import type { Tool } from '../types';
import { meta } from './meta';
import { ReadabilityAnalyzerUi } from './ui';

const tool: Tool = { meta, Component: ReadabilityAnalyzerUi };
export default tool;
