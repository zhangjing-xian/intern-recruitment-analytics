/**
 * Service Worker 的注册与**用户可控的更新提示**（步骤13，docs/PRD.md 18.6）。
 *
 * ## 三条刻意的设计
 *
 * 1. **不自动 `skipWaiting`**：新版 Service Worker 装好后停在 `waiting`，界面提示「有新版本」，
 *    由用户点击才切换并刷新。理由是本应用的界面里可能有正在进行的事（正在核对 AI 预览、
 *    正在等一次响应、正在看长表格），把页面在别人眼皮底下换掉是不可接受的；
 * 2. **更新不涉及任何业务数据**：SW 只管理**静态资源缓存**，招聘数据在加密仓（IndexedDB）里，
 *    两者互不相干；因此「刷新拿新版本」不会丢数据集，也不会要求重新导入（口径见 D-084）；
 * 3. **注册只在生产 + 支持 SW 的环境里发生**：dev server 下注册会缓存住开发资源，
 *    让改代码看不到效果——所以 `import.meta.env.DEV` 直接返回。
 *
 * ## 为什么要有这个模块（而不是在 main.tsx 里写十几行）
 *
 * 注册与更新检测是有状态、有回调、要能被测试的：把它做成可注入依赖的纯函数（`register` 参数化
 * `serviceWorker` / `baseUrl` / 回调），组件层只负责把结论渲染成一句话。
 * 这样「不自动更新」「只在等待时才提示」这两条可以被测到，而不是靠读代码确认。
 *
 * 本模块不依赖 React；只有 `UpdateNotice.tsx` 用它的钩子。
 */

/** 可注入的最小 Service Worker 容器形状（浏览器里就是 `navigator.serviceWorker`） */
export type ServiceWorkerContainerLike = {
  readonly controller: unknown
  register: (scriptUrl: string, options?: { readonly scope?: string }) => Promise<ServiceWorkerRegistrationLike>
  addEventListener: (type: 'controllerchange', listener: () => void) => void
  removeEventListener: (type: 'controllerchange', listener: () => void) => void
}

/** 可注入的最小注册对象形状（只用到等待中的 worker 与它的状态变化） */
export type ServiceWorkerRegistrationLike = {
  readonly waiting: ServiceWorkerLike | null
  readonly installing: ServiceWorkerLike | null
  addEventListener: (type: 'updatefound', listener: () => void) => void
  removeEventListener: (type: 'updatefound', listener: () => void) => void
}

export type ServiceWorkerLike = {
  readonly state: string
  addEventListener: (type: 'statechange', listener: () => void) => void
  removeEventListener: (type: 'statechange', listener: () => void) => void
  postMessage: (message: unknown) => void
}

export type RegisterOptions = {
  /** 容器；缺省用 `navigator.serviceWorker`（Node 里不存在，因此调用方会跳过） */
  readonly container?: ServiceWorkerContainerLike | undefined
  /** 站点根（`import.meta.env.BASE_URL`），子路径部署时 SW 的作用域跟着它走 */
  readonly baseUrl?: string
  /** 是否处于开发模式（dev 下不注册，否则会缓存住开发资源） */
  readonly dev?: boolean
  /** 发现「有新版本在等待」时调用（界面据此显示提示） */
  readonly onUpdateReady?: () => void
  /** 新版本接管后调用（界面据此刷新或提示） */
  readonly onControllerChange?: () => void
}

export type RegisterResult =
  | { readonly status: 'unsupported' }
  | { readonly status: 'skipped-dev' }
  | { readonly status: 'registered'; readonly registration: ServiceWorkerRegistrationLike }
  | { readonly status: 'failed'; readonly reason: string }

/**
 * 注册 Service Worker 并订阅更新。
 *
 * 返回一个**稳定的**结果对象供测试与界面使用；注册失败不抛错（SW 是增强能力，
 * 失败不该让页面打不开——尤其是 `file://` 或隐私模式下浏览器会直接拒绝）。
 */
export async function registerServiceWorker(
  options: RegisterOptions = {},
): Promise<RegisterResult> {
  if (options.dev === true) {
    return { status: 'skipped-dev' }
  }
  const container = options.container ?? undefined
  if (container === undefined) {
    return { status: 'unsupported' }
  }
  const base = options.baseUrl ?? '/'
  const scope = base.endsWith('/') ? base : `${base}/`
  const scriptUrl = `${scope}sw.js`
  try {
    const registration = await container.register(scriptUrl, { scope })

    const notifyIfWaiting = (): void => {
      if (registration.waiting !== null) {
        options.onUpdateReady?.()
      }
    }
    // 首帧就可能已经有一个等待中的新版本（上一次访问留下的）
    notifyIfWaiting()

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (installing === null) {
        return
      }
      installing.addEventListener('statechange', () => {
        // 只有「已装好且已有一个在控制页面的版本」才是更新；首次安装不提示
        if (installing.state === 'installed' && container.controller !== null) {
          options.onUpdateReady?.()
        }
      })
    })

    if (options.onControllerChange !== undefined) {
      const listener = (): void => {
        options.onControllerChange?.()
      }
      container.addEventListener('controllerchange', listener)
    }

    return { status: 'registered', registration }
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error && error.message.trim() !== '' ? error.message : '注册失败',
    }
  }
}

/**
 * 让等待中的新版本接管（**只由用户点击触发**）。
 *
 * 为什么不在这里顺便刷新：刷新时机由界面决定（它知道自己在显示什么），
 * 而且「点一下就 reload」在测试里无法核对到底是谁触发的。
 */
export function applyWaitingUpdate(registration: ServiceWorkerRegistrationLike | null): boolean {
  if (registration === null || registration.waiting === null) {
    return false
  }
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}
