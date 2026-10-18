import type { Tool } from '../types';
import { meta } from './meta';
import { X509CertificateDecoderUi } from './ui';

const tool: Tool = { meta, Component: X509CertificateDecoderUi };
export default tool;
