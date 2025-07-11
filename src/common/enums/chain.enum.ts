export enum Chain {
  TRON = 'TRON',
  BTC = 'BTC',
  ETH = 'ETH',
  EVM_BASE = 'EVM_BASE',
  EVM_BSC = 'EVM_BSC',
  EVM_POLYGON = 'EVM_POLYGON',
  EVM_ARBITRUM = 'EVM_ARBITRUM',
  EVM_OPTIMISM = 'EVM_OPTIMISM',
  EVM_AVALANCHE_C = 'EVM_AVALANCHE_C',
  EVM_FANTOM = 'EVM_FANTOM',
}

export const EVM_CHAINS: Chain[] = [
  Chain.ETH,
  Chain.EVM_BASE,
  Chain.EVM_BSC,
  Chain.EVM_POLYGON,
  Chain.EVM_ARBITRUM,
  Chain.EVM_OPTIMISM,
  Chain.EVM_AVALANCHE_C,
  Chain.EVM_FANTOM,
] as const
