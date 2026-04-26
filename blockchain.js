"use strict";

// Network message constants
const MISSING_BLOCK = "MISSING_BLOCK";
const POST_TRANSACTION = "POST_TRANSACTION";
const PROOF_FOUND = "PROOF_FOUND";
const START_MINING = "START_MINING";

// Constants for mining
const NUM_ROUNDS_MINING = 2000;

// Constants related to proof-of-work target
const POW_BASE_TARGET = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const POW_LEADING_ZEROES = 15;

// Constants for mining rewards and default transaction fees
const COINBASE_AMT_ALLOWED = 25;
const DEFAULT_TX_FEE = 1;

// If a block is 6 blocks older than the current block, it is considered
// confirmed, for no better reason than that is what Bitcoin does.
// Note that the genesis block is always considered to be confirmed.
const CONFIRMED_DEPTH = 6;

// Constants
const TARGET_BLOCK_TIME = .2 * 1000; // x second x 1000 milliseconds per block
const DIFFICULTY_WINDOW = 5; // adjust every x blocks
const MAX_ADJUST = 4; // adjust by at most a factor of x, either x times harder or 1/x times easier
const TARGET_WINDOW_TIME = DIFFICULTY_WINDOW * TARGET_BLOCK_TIME;
/**
 * The Blockchain class tracks configuration information and settings for the
 * blockchain, as well as some utility methods to allow for easy extensibility.
 * Note that the genesis block is the only direct reference to a block, since
 * different clients may have different blocks.
 */
module.exports = class Blockchain {
  static get MISSING_BLOCK() { return MISSING_BLOCK; }
  static get POST_TRANSACTION() { return POST_TRANSACTION; }
  static get PROOF_FOUND() { return PROOF_FOUND; }
  static get START_MINING() { return START_MINING; }

  static get NUM_ROUNDS_MINING() { return NUM_ROUNDS_MINING; }

  // Configurable properties, with static getters for convenience.
  static get POW_TARGET() {
    let bc = Blockchain.getInstance();
    return bc.powTarget;
  }

  static get COINBASE_AMT_ALLOWED() {
    let bc = Blockchain.getInstance();
    return bc.coinbaseReward;
  }

  static get DEFAULT_TX_FEE() {
    let bc = Blockchain.getInstance();
    return bc.defaultTxFee;
  }

  static get CONFIRMED_DEPTH() {
    let bc = Blockchain.getInstance();
    return bc.confirmedDepth;
  }
  

  /**
   * Produces a new genesis block, giving the specified clients the amount of
   * starting gold specified in the initialBalances field of the Blockchain
   * instance.  This function also sets the genesis block for every client in
   * the clients field of the Blockchain instance.
   *
   * @returns {Block} - The genesis block.
   */
  static makeGenesis() {

    let g = this.makeBlock();

    let bc = Blockchain.getInstance();

    // Initializing starting balances in the genesis block.
    g.balances = new Map(bc.initialBalances);
    g.merkleRoot = g.constructor.calculateMerkleRoot(g.transactions);

    for (let client of bc.clients) {
      client.setGenesisBlock(g);
    }

    return g;
  }

  /**
   * Converts a string representation of a block to a new Block instance.
   *
   * @param {Object} o - An object representing a block, but not necessarily an instance of Block.
   *
   * @returns {Block}
   */
  static deserializeBlock(o) {
    if (o instanceof this.instance.blockClass) {
      return o;
    }

    let b = new this.instance.blockClass();
    b.chainLength = parseInt(o.chainLength, 10);
    b.timestamp = o.timestamp;
    if (o.target !== undefined) {
      b.target = BigInt(o.target);
    }

    if (b.isGenesisBlock()) {
      // Balances need to be recreated and restored in a map.
      o.balances.forEach(([clientID,amount]) => {
        b.balances.set(clientID, amount);
      });
      b.merkleRoot = o.merkleRoot || b.constructor.calculateMerkleRoot(b.transactions);
    } else {
      b.prevBlockHash = o.prevBlockHash;
      b.proof = o.proof;
      b.rewardAddr = o.rewardAddr;
      // Likewise, transactions need to be recreated and restored in a map.
      b.transactions = new Map();
      if (o.transactions) o.transactions.forEach(([txID,txJson]) => {
        let tx = this.makeTransaction(txJson);
        b.transactions.set(txID, tx);
      });
      b.merkleRoot = o.merkleRoot || b.constructor.calculateMerkleRoot(b.transactions);
    }

    return b;
  }

  /**
   * @param  {...any} args - Arguments for the Block constructor.
   * 
   * @returns {Block}
   */
  static makeBlock(...args) {
    let bc = Blockchain.getInstance();
    return bc.makeBlock(...args);
  }

  /**
   * @param  {...any} args - Arguments for the Transaction constructor.

   * @returns {Transaction}
   */
  static makeTransaction(...args) {
    let bc = Blockchain.getInstance();
    return bc.makeTransaction(...args);
  }

  /**
   * Get the instance of the blockchain configuration class.
   * 
   * @returns {Blockchain}
   */
  static getInstance() {
    if (!this.instance) {
      throw new Error("The blockchain has not been initialized.");
    }
    return this.instance;
  }

  /**
   * Check if Blockchain instance exists
   * 
   * @returns {Blockchain}
   */
  static hasInstance() {
    return (this.instance ? true : false);
  }

  /**
   * Creates the new instance of the blockchain configuration, giving the
   * clients the amount of starting gold specified in the clients array.
   * This will also create the genesis block, but will not start mining.
   *
   * @param {Object} cfg - Settings for the blockchain.
   * @param {Class} cfg.blockClass - Implementation of the Block class.
   * @param {Class} cfg.transactionClass - Implementation of the Transaction class.
   * @param {Array} [cfg.clients] - An array of client/miner configurations.
   * @param {String} [cfg.mnemonic] - BIP39 mnemonic which is used to generate client addresses.
   * @param {number} [cfg.powLeadingZeroes] - Number of leading zeroes required for a valid proof-of-work.
   * @param {number} [cfg.coinbaseAmount] - Amount of gold awarded to a miner for creating a block.
   * @param {number} [cfg.defaultTxFee] - Amount of gold awarded to a miner for accepting a transaction,
   *    if not overridden by the client.
   * @param {number} [cfg.confirmedDepth] - Number of blocks required after a block before it is
   *    considered confirmed.
   *
   * @returns {Blockchain} - The blockchain configuration instance.
   */
  static createInstance(cfg) {
    this.instance = new Blockchain(cfg);
    this.instance.genesis = this.makeGenesis();
    return this.instance;
  }


  /**
   * Constructor for the Blockchain configuration.  This constructor should not
   * be called outside of the class; nor should it be called more than once.
   *
   * @constructor
   */
  constructor({
    blockClass,
    transactionClass,
    clientClass,
    minerClass,
    powLeadingZeroes = POW_LEADING_ZEROES,
    coinbaseReward = COINBASE_AMT_ALLOWED,
    defaultTxFee = DEFAULT_TX_FEE,
    confirmedDepth = CONFIRMED_DEPTH,
    clients = [],
    mnemonic,
    net,
  }) {

    if (this.constructor.instance) {
      throw new Error("The blockchain has already been initialized.");
    }

    // Storing details on classes.
    if (blockClass) {
      this.blockClass = blockClass;
    } else {
      this.blockClass = require('./block');
    }
    if (transactionClass) {
      this.transactionClass = transactionClass;
    } else {
      this.transactionClass = require('./transaction');
    }
    if (clientClass) {
      this.clientClass = clientClass;
    } else {
      this.clientClass = require('./client');
    }
    if (minerClass) {
      this.minerClass = minerClass;
    } else {
      this.minerClass = require('./miner');
    }

    this.clients = [];
    this.miners = [];
    this.clientAddressMap = new Map();
    this.clientNameMap = new Map();
    this.net = net;

    this.powLeadingZeroes = powLeadingZeroes;
    this.coinbaseReward = coinbaseReward;
    this.defaultTxFee = defaultTxFee;
    this.confirmedDepth = confirmedDepth;

    this.powTarget = POW_BASE_TARGET >> BigInt(powLeadingZeroes);

    this.initialBalances = new Map();

    // generate random mnemonic if mnemonic not passed
    if (mnemonic === undefined){
      const { generateMnemonic } = require('bip39');
      this.mnemonic = generateMnemonic(256);
    }
    else{
      this.mnemonic = mnemonic;
    }

    clients.forEach((clientCfg) => {
      console.log(`Adding client ${clientCfg.name}`);
      let client;
      if (clientCfg.mining) {
        client = new this.minerClass({
          name: clientCfg.name,
          password: clientCfg.password ? clientCfg.password : clientCfg.name+'_pswd',
          net: this.net,
          miningRounds: clientCfg.miningRounds,
        });
        client.generateAddress(this.mnemonic);
        // Miners are stored as both miners and clients.
        this.miners.push(client);
      } else {
        client = new this.clientClass({
          name: clientCfg.name,
          password: clientCfg.password ? clientCfg.password : clientCfg.name+'_pswd',
          net: this.net,
        });
        client.generateAddress(this.mnemonic);
      }

      this.clientAddressMap.set(client.address, client);
      if (client.name) this.clientNameMap.set(client.name, client);

      this.clients.push(client);
      this.net.register(client);

      this.initialBalances.set(client.address, clientCfg.amount);
    });

  }

  /**
   * Prints out the balances from one client's view of the blockchain.  A
   * specific client may be named; if no client name is specified, then the
   * first client in the clients array is used.
   * 
   * @param {string} [name] - The name of the client whose view
   *    of the blockchain will be used.
   */
  showBalances(name) {
    let client = name ? this.clientNameMap.get(name) : this.clients[0];
    if (!client) throw new Error("No client found.");
    client.showAllBalances();
  }

  /**
   * Tells all miners to start mining new blocks.
   * 
   * @param {number} [ms] - Delay in milliseconds before the blockchain
   *    terminates.  If omitted, the program will run indefinitely.
   * @param {Function} [f] - Callback function that will be executed when the
   */
  start(ms, f) {
    this.miners.forEach((miner) => {
      miner.initialize();
    });

    if (ms) {
      setTimeout(() => {
        if (f) f();
        process.exit(0);
      }, ms);
    }
  }

  /**
   * @param  {...any} args - Parameters for the Block constructor.
   * 
   * @returns {Block}
   */
  makeBlock(...args) {
    return new this.blockClass(...args);
  }

  /**
   * @param {*} o - Either an object with the transaction details, o an
   *    instance of the Transaction class.
   * 
   * @returns  {Transaction}
   */
  makeTransaction(o) {
    if (o instanceof this.transactionClass) {
      return o;
    } else {
      return new this.transactionClass(o);
    }
  }

  /**
   * Looks up clients by name, returning a list of the matching clients.
   * 
   * @param  {...string} names - Names of all clients to return.
   * 
   * @returns {Array} - An array of clients
   */
  getClients(...names) {
    let clients = [];
    names.forEach((clientName) => {
      clients.push(this.clientNameMap.get(clientName));
    });
    return clients;
  }

  register(...clients) {
    clients.forEach((client) => {
      this.clientAddressMap.set(client.address, client);
      if (client.name) this.clientNameMap.set(client.name, client);

      // Add client to the list of clients and (if a miner) the list of miners.
      this.clients.push(client);
      if (client instanceof this.minerClass) this.miners.push(client);

      // Set the "network" connection for the client.
      client.net = this.net;
      this.net.register(client);
    });
  }

  getClientName(address) {
    if (!this.clientAddressMap.has(address)) {
      return;
    }
    let client = this.clientAddressMap.get(address);
    return client.name;
  }

  /**
   * Calculates the new proof-of-work target
   * 
   * @param {Block} prevBlock - The most recently mined block.
   * @param {Map} blockMap - A map of block hashes to Block objects, used to traverse the chain.
   * 
   * @returns {BigInt} - The new mining target for the next block.
   */
  getAdjustedTarget(prevBlock, blockMap) {
  if (!prevBlock) return this.powTarget;

  // only adjust after every x amount of blocks
  if (prevBlock.chainLength < DIFFICULTY_WINDOW || prevBlock.chainLength % DIFFICULTY_WINDOW !== 0) {
    return prevBlock.target;
  }

  console.log('\n');
  console.log('=====================================');
  console.log(` ADJUSTING POW DIFFICULTY at block ${prevBlock.chainLength}`);

  let firstBlock = prevBlock;

  // traverse back through to find the timestamp of the block x blocks ago
  for (let i = 0; i < DIFFICULTY_WINDOW; i++) {
    if (!blockMap) return prevBlock.target;

    firstBlock = blockMap.get(firstBlock.prevBlockHash);

    if (!firstBlock) return prevBlock.target;
  }

  // calculate the time taken to mine the last x blocks (from firstBlock to prevBlock)
  let actualTime = prevBlock.timestamp - firstBlock.timestamp;

  // calculate the ratio of actual time to expected time
  let ratio = actualTime / TARGET_WINDOW_TIME;

  // the adjustment ratio to be within the bounds of MAX_ADJUST
  let targetRatio = Math.max(1 / MAX_ADJUST, Math.min(MAX_ADJUST, ratio));

  console.log('\n');
  console.log(` actualTime:   ${actualTime} ms`);
  console.log(` expectedTime: ${TARGET_WINDOW_TIME} ms`);
  console.log(` ratio:        ${ratio.toFixed(4)}`);
  console.log(` targetRatio:  ${targetRatio.toFixed(4)}`);

  // we multiply and divide by SCALE to avoid floating point issues.
  const SCALE = 1000n;
  let scaledRatio = BigInt(Math.floor(targetRatio * 1000));

  // calculate the new target, adjusting by the target ratio
  let oldTarget = BigInt(prevBlock.target);
  let newTarget = (BigInt(prevBlock.target) * scaledRatio) / SCALE;

  // ensure difficulty never drops below the initial baseline
  if (newTarget > POW_BASE_TARGET) {
    newTarget = POW_BASE_TARGET;
  }

  console.log(`\n DYNAMIC POW: old target: ${oldTarget}`);
  console.log(` DYNAMIC POW: new target: ${newTarget}`);

  if (newTarget < oldTarget) {
    console.log(` DYNAMIC POW: ↑ Difficulty increased (harder)`);
  } else if (newTarget > oldTarget) {
    console.log(` DYNAMIC POW: ↓ Difficulty decreased (easier)`);
  } else {
    console.log(` DYNAMIC POW: No change`);
  }

  console.log('=====================================\n');

  return newTarget;
}
};
