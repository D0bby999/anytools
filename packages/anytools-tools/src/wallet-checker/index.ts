import type { Tool } from '../types';
import { meta } from './meta';
import { WalletCheckerUi } from './ui';

const tool: Tool = { meta, Component: WalletCheckerUi };
export default tool;
