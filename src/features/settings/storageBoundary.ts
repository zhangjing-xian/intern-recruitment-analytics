/**
 * 存储边界与多标签页协作的**事实清单**（步骤12，纯常量，不依赖 React / Dexie / DOM）。
 *
 * 为什么要把这些事实集中成一个数据文件，而不是直接写在面板的 JSX 里：
 * 它们是「我们这个应用到底做了什么」的对外声明，必须能被单测逐条钉住；
 * 而且要能验证「面板真的把它们渲染出来了」——`StorageBoundaryPanel` 只摆放这份数据，
 * 文案不复制、不改写，避免界面与说明慢慢说岔。
 *
 * 三条写作纪律：
 * 1. **只说现状**：跨标签页的失效是**推送式**的——另一个标签页改密 / 清空时，
 *    IndexedDB 会通过 `versionchange` 主动通知本标签页，我们随即关闭连接、丢弃内存密钥，
 *    并广播「锁定（原因：其他标签页）」让界面能解释发生了什么（`storage/db.ts`）。
 *    而 `vaultEvents` 这一层本身只是**同页面内**的通道（模块级 `Set<监听器>`），
 *    不跨标签广播——两件事不能混为一谈，因此下面把「谁推、谁不推」分开写清。
 * 2. **不承诺**：持久化申请只降低被回收的概率，由浏览器裁定；配额未知时显示未知，
 *    不显示 0（0 会被读成「没占用」）。
 * 3. **可核对**：每条事实都对应仓库里的具体模块，见每条下面的 `source` 字段。
 */

export type StorageBoundaryFact = {
  readonly id: string
  /** 一句话结论（面板加粗显示） */
  readonly title: string
  /** 展开说明：必须写清「谁负责、什么时候发生、做不到什么」 */
  readonly detail: string
  /** 对应实现位置（便于核对，不是给用户看的营销标签） */
  readonly source: string
}

export const VAULT_EVENT_NOTICE =
  '多标签页提示：另一个标签页改密或清空本地仓时，浏览器会主动通知本页，本页随即关闭连接、丢弃内存密钥并显示「其他标签页修改了本地仓」——这是推送式的失效，不是等到下次读写才发现。'

export const STORAGE_BOUNDARY_FACTS: readonly StorageBoundaryFact[] = [
  {
    id: 'same-page-events',
    title: '仓状态变化在本页内即时生效',
    detail:
      '锁定、解锁、改密、清空、连接被关闭都会通过同页面的事件通道广播给监听者：应用外壳收到锁定或清空后立刻丢弃内存中的导入结果、已提交数据集与映射草稿，并停止闲置计时。这条通道只在当前页面内有效。',
    source: 'storage/vaultEvents.ts + storage/vaultSession.ts',
  },
  {
    id: 'cross-tab-detection',
    title: '其他标签页改密 / 清空会被主动通知，不是等你下次操作',
    detail:
      '另一个标签页改密或清空本地仓时，IndexedDB 会向本标签页推送 `versionchange`；本页收到后立刻关闭连接、丢弃内存密钥，并广播一次「锁定（原因：其他标签页）」，因此界面能明确解释「为什么刚才还能看的数据没了」，而不是等下一次读写才被动发现。此外每次写入前仍会比对仓版本号与内存密钥版本号，不一致就拒绝写入，避免用旧密钥写出永远解不开的数据——推送与校验是两道互补的保险。',
    source: 'storage/db.ts 的 versionchange + storage/vaultEvents.ts + storage/vault.ts 的 requireFreshMeta',
  },
  {
    id: 'blocked-by-other-tabs',
    title: '其他标签页还占着仓时，清空会失败而不是假装成功',
    detail:
      '删除数据库需要其他连接先关闭。浏览器拒绝时界面按「其他标签页仍在使用本地仓，请关闭这些标签页后重试」如实提示；已保存的数据不会被破坏。',
    source: 'storage/errors.ts 的 blocked + storage/vault.ts 的 clearVault',
  },
  {
    id: 'quota-estimate',
    title: '存储占用与配额按浏览器实际给的值展示',
    detail:
      '占用与配额由浏览器的存储估算接口提供；接口不存在（部分浏览器或隐私模式）或任一侧未知时，界面显示「未知」而不是 0——0 会被读成「没有占用」，那是错的。',
    source: 'storage/quota.ts + features/settings/vaultText.ts 的 formatStorageUsage',
  },
  {
    id: 'persist-request',
    title: '持久化申请由浏览器裁定，只降低被回收的概率',
    detail:
      '「申请持久化存储」会把请求交给浏览器，同意与否由浏览器决定，界面按最新状态如实展示。即使申请成功也不是保证：清理站点数据、无痕窗口关闭、系统级清理都可能让本地数据消失，所以重要数据必须另存加密备份。',
    source: 'storage/quota.ts 的 requestPersistentStorage',
  },
  {
    id: 'no-plaintext',
    title: '本机存储里没有明文业务数据',
    detail:
      '加密仓只写密文信封与最小非敏感元数据（仓 ID、KDF 参数、版本号、闲置分钟数、用于校验密码的加密校验串）。对象种类是固定枚举、不携带业务含义；姓名、薪资、HR、文件名等都不建立索引，因此无法被明文检索；锁定后内存中的密钥被丢弃。',
    source: 'storage/vaultMeta.ts + storage/vault.ts',
  },
  {
    id: 'no-third-party-storage',
    title: '不往浏览器之外或第三方存储写任何东西',
    detail:
      '除本站自己的 IndexedDB 数据库外，不写 localStorage / sessionStorage / Cookie，也不注册 Service Worker；没有上报通道，因此也没有任何「把错误日志带出去」的路径。',
    source: 'src 内无 localStorage / sessionStorage / cookie / serviceWorker 写入点',
  },
]
