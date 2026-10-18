import type { Tool } from '../types';
import { meta } from './meta';
import { CurrencyConverterUi } from './ui';

const tool: Tool = { meta, Component: CurrencyConverterUi };
export default tool;
