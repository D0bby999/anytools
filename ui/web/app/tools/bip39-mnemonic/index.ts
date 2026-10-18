import type { Tool } from '../types';
import { meta } from './meta';
import { Bip39MnemonicUi } from './ui';

const tool: Tool = { meta, Component: Bip39MnemonicUi };
export default tool;
