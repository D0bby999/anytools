import type { Tool } from '../types';
import { meta } from './meta';
import { SalesTaxCalculatorUi } from './ui';

const tool: Tool = { meta, Component: SalesTaxCalculatorUi };
export default tool;
