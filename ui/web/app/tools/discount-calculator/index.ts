import type { Tool } from '../types';
import { meta } from './meta';
import { DiscountCalculatorUi } from './ui';

const tool: Tool = { meta, Component: DiscountCalculatorUi };
export default tool;
