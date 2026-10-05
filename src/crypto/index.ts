/**
 * 加密层统一出口（步骤6）。
 *
 * 约定：
 * - 本层只依赖 Web Crypto 与标准 API，**不**依赖 React / IndexedDB / 网络，可单独测试；
 * - 原子操作（编解码、KDF、信封）在这一层，业务语义（仓、对象、秘密槽位）在 `src/storage`；
 * - 本层不打印、不写日志，也不把密钥或明文挂到全局对象上。
 */

export * from './encoding'
export * from './envelope'
export * from './errors'
export * from './kdf'
export * from './keys'
export * from './random'
