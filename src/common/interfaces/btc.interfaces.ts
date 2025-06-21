// --- Interfaces for Ankr API Response ---
// These interfaces match the structure of the data returned by Ankr's Blockbook API.
interface AnkrVout {
  value: string
  addresses?: string[]
  isAddress: boolean
  n: number
}

interface AnkrVin {
  n: number
  isAddress: boolean
  value: string
}

export interface AnkrTransaction {
  txid: string
  vin: AnkrVin[]
  vout: AnkrVout[]
  confirmations: number
}

export interface AnkrBlock {
  page: number
  totalPages: number
  itemsOnPage: number
  hash: string
  previousBlockHash: string
  nextBlockHash: string
  height: number
  confirmations: number
  size: number
  time: number
  version: number
  merkleRoot: string
  nonce: string
  bits: string
  difficulty: string
  txCount: number
  txs: AnkrTransaction[]
}

export interface AnkrStatus {
  blockbook: {
    coin: 'Bitcoin'
    network: 'BTC'
    host: string
    version: string
    gitCommit: string
    buildTime: string
    syncMode: boolean
    initialSync: boolean
    inSync: boolean
    bestHeight: number
    lastBlockTime: string
    inSyncMempool: boolean
    lastMempoolTime: string
    mempoolSize: number
    decimals: number
    dbSize: number
    hasFiatRates: boolean
    currentFiatRatesTime: string
    historicalFiatRatesTime: string
    about: string
  }
  backend: {
    chain: string
    blocks: number
    headers: number
    bestBlockHash: string
    difficulty: string
    sizeOnDisk: number
    version: string
    subversion: string
    protocolVersion: string
  }
}

export interface AnkrAddress {
  page: number
  totalPages: number
  itemsOnPage: number
  address: string
  balance: string
  totalReceived: string
  totalSent: string
  unconfirmedBalance: string
  unconfirmedTxs: number
  txs: number
  txids: string[]
}
