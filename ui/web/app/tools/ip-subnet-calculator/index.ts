import type { Tool } from '../types';
import { meta } from './meta';
import { IpSubnetCalculatorUi } from './ui';

const tool: Tool = { meta, Component: IpSubnetCalculatorUi };
export default tool;
