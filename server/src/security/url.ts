import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const privateIpv4 = (address: string) => {
  const octets = address.split('.').map(Number);
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
};
const privateIpv6 = (address: string) => {
  const value = address.toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.');
};
export const isPrivateAddress = (address: string) => isIP(address) === 4 ? privateIpv4(address) : isIP(address) === 6 && privateIpv6(address);

export const parsePublicHttpUrl = (value: string) => {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateAddress(host)) return undefined;
  return url;
};

export const assertPublicHttpUrl = async (value: string) => {
  const url = parsePublicHttpUrl(value);
  if (!url) throw new Error('通知地址必须是公开的 HTTP(S) 地址');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('通知地址不能指向内网或本机');
  return url;
};
