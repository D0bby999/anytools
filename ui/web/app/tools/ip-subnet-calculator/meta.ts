import type { ToolMeta } from '../types';

export const meta: ToolMeta = {
  slug: 'ip-subnet-calculator',
  cluster: 'converters',
  title: {
    en: 'IP Subnet Calculator (CIDR)',
    vi: 'Tính Subnet IP (CIDR)',
    es: 'Calculadora de Subred IP (CIDR)',
    pt: 'Calculadora de Sub-rede IP (CIDR)',
  },
  description: {
    en: 'IPv4 CIDR calculator — network, broadcast, usable host range, netmask, wildcard, binary view, class and private/public detection. 100% local.',
    vi: 'Tính CIDR IPv4 — địa chỉ mạng, broadcast, dải host dùng được, netmask, wildcard, dạng nhị phân, class và private/public. 100% offline.',
    es: 'Calculadora CIDR IPv4 — red, broadcast, rango de hosts, máscara, wildcard, vista binaria, clase y detección privada/pública.',
    pt: 'Calculadora CIDR IPv4 — rede, broadcast, faixa de hosts, máscara, wildcard, visão binária, classe e detecção privada/pública.',
  },
  keywords: [
    'subnet calculator',
    'cidr calculator',
    'ip calculator',
    'ipv4 subnet',
    'netmask calculator',
    'network address',
    'tính subnet',
    'calculadora subred',
    'calculadora sub-rede',
  ],
  priority: 'P2',
  effort: 'S',
  nextStepSuggestions: [
    {
      tool: 'binary-encode',
      reason: {
        en: 'Play with more binary/decimal conversions',
        vi: 'Chuyển đổi nhị phân/thập phân thêm',
        es: 'Más conversiones binario/decimal',
        pt: 'Mais conversões binário/decimal',
      },
    },
  ],
};
