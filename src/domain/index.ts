/**
 * 领域层统一出口（步骤2 建立的数据契约）。
 *
 * 约定：数据层与界面只从 `src/domain` 导入，不直接 import 具体文件；
 * 这样后续拆分 / 替换实现（如模板改用 xlsx）时影响面可控。
 */

export * from './analytics'
export * from './configVersion'
export * from './enums'
export * from './fields'
export * from './identity'
export * from './mapping'
export * from './quality'
export * from './template'
export * from './types'
export * from './valueMappings'
export * from './version'
