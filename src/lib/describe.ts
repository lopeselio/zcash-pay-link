import type { DecodedAddress, Network } from 'zip321';

const KIND_NAMES: Record<DecodedAddress['kind'], string> = {
  unified: 'Unified Address',
  sapling: 'Sapling address',
  p2pkh: 'Transparent address',
  p2sh: 'Transparent address (P2SH)',
  tex: 'TEX address',
};

const NETWORK_NAMES: Record<Network, string> = {
  main: 'mainnet',
  test: 'testnet',
  regtest: 'regtest',
};

/** "mainnet", "testnet", or "testnet or regtest" for transparent test addresses. */
export function describeNetworks(networks: readonly Network[]): string {
  return networks.map((n) => NETWORK_NAMES[n]).join(' or ');
}

/** "Orchard + Sapling + transparent receivers" for a Unified Address, else undefined. */
export function describeReceivers(address: DecodedAddress): string | undefined {
  if (!address.receivers) return undefined;
  const kinds = new Set(address.receivers.map((r) => r.kind));
  const names: string[] = [];
  if (kinds.has('orchard')) names.push('Orchard');
  if (kinds.has('sapling')) names.push('Sapling');
  if (kinds.has('p2pkh') || kinds.has('p2sh')) names.push('transparent');
  const unknown = address.receivers.filter((r) => r.kind === 'unknown').length;
  if (unknown) names.push(`${unknown} unknown`);
  if (names.length === 0) return undefined;
  return `${names.join(' + ')} receiver${address.receivers.length === 1 ? '' : 's'}`;
}

/** One line for people: "Unified Address · mainnet · Orchard + Sapling + transparent receivers". */
export function describeAddress(address: DecodedAddress): string {
  const parts = [KIND_NAMES[address.kind], describeNetworks(address.networks)];
  const receivers = describeReceivers(address);
  if (receivers) parts.push(receivers);
  return parts.join(' · ');
}
