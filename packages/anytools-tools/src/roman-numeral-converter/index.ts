import type { Tool } from '../types';
import { meta } from './meta';
import { RomanNumeralConverterUi } from './ui';

const tool: Tool = { meta, Component: RomanNumeralConverterUi };
export default tool;
