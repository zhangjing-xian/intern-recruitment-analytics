/**
 * 「有新版本可用」提示条（步骤13）。
 *
 * ## 行为约定（每一条都有理由）
 *
 * - **只在真的有一个等待中的新版本时出现**：首次安装不提示（`registerServiceWorker` 里判断
 *   `controller !== null`）；
 * - **不自动刷新**：只有点「立即更新」才 `SKIP_WAITING`；点「稍后」只是收起提示，
 *   下次打开仍然会用新版本；
 * - **不阻塞界面**：提示条在页面底部、可关闭，不做模态遮罩——它不该拦住正在核对预览/等响应的人；
 * - **失败不吓人**：Service Worker 不可用（隐私模式、`file://`、旧浏览器）时**什么都不显示**，
 *   因为离线能力是增强项，缺了它应用照常工作。
 *
 * 组件只消费 `registerServiceWorker` 的结论；注册逻辑本身不在这里。
 */

import { useEffect, useState } from 'react'

import {
  applyWaitingUpdate,
  registerServiceWorker,
  type ServiceWorkerContainerLike,
  type ServiceWorkerRegistrationLike,
} from './registerServiceWorker'
import {
  PWA_UPDATE_APPLY_LABEL,
  PWA_UPDATE_BODY,
  PWA_UPDATE_LATER_LABEL,
  PWA_UPDATE_LATER_NOTE,
  PWA_UPDATE_TITLE,
} from './pwaText'

export type UpdateNoticeProps = {
  /**
   * 测试接缝：注入一个假的 Service Worker 容器。
   * 缺省时从 `navigator.serviceWorker` 取（Node / 旧浏览器里取不到，于是整条链路静默跳过）。
   */
  readonly container?: ServiceWorkerContainerLike | undefined
  /** 站点根（`import.meta.env.BASE_URL`）：子路径部署时作用域跟着它走 */
  readonly baseUrl?: string
  /** 开发模式下不注册（会缓存住开发资源） */
  readonly dev?: boolean
}

/** 从全局取容器：拿不到就返回 undefined（不抛错，也不假装有） */
function containerOf(provided: ServiceWorkerContainerLike | undefined): ServiceWorkerContainerLike | undefined {
  if (provided !== undefined) {
    return provided
  }
  const navigatorLike = globalThis.navigator as { serviceWorker?: ServiceWorkerContainerLike } | undefined
  return navigatorLike?.serviceWorker
}

export default function UpdateNotice({ container, baseUrl, dev }: UpdateNoticeProps) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistrationLike | null>(null)
  const [dismissed, setDismissed] = useState(false)

  /**
   * 注册一次。`setState` 只发生在 promise 回调里（不在 effect 体内同步触发），
   * 避免级联渲染——与项目里其他 effect 的处理一致。
   */
  useEffect(() => {
    let cancelled = false
    void registerServiceWorker({
      container: containerOf(container),
      baseUrl: baseUrl ?? import.meta.env.BASE_URL,
      dev: dev ?? import.meta.env.DEV,
      onUpdateReady: () => {
        if (!cancelled) {
          setDismissed(false)
        }
      },
    }).then((result) => {
      if (cancelled) {
        return
      }
      setRegistration(result.status === 'registered' ? result.registration : null)
      if (result.status === 'registered' && result.registration.waiting !== null) {
        // 已经有一个等待中的新版本（上次留下的）：直接显示提示
        setDismissed(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [container, baseUrl, dev])

  const updateReady =
    registration !== null &&
    (registration.waiting !== null || (registration.installing !== null && registration.installing.state === 'installed'))

  if (!updateReady || dismissed) {
    return null
  }

  return (
    <div
      className="border-t border-indigo-200 bg-indigo-50"
      data-testid="pwa-update-notice"
      role="status"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-indigo-900">{PWA_UPDATE_TITLE}</p>
          <p className="text-xs leading-5 text-indigo-900">{PWA_UPDATE_BODY}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-800"
            onClick={() => {
              if (applyWaitingUpdate(registration)) {
                // 交给 controllerchange 之后的刷新；这里不主动 reload，避免打断用户
                setDismissed(true)
              }
            }}
            type="button"
          >
            {PWA_UPDATE_APPLY_LABEL}
          </button>
          <button
            className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs text-indigo-900 hover:bg-white"
            onClick={() => {
              setDismissed(true)
            }}
            type="button"
          >
            {PWA_UPDATE_LATER_LABEL}
          </button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 pb-3 text-xs leading-5 text-indigo-800">
        {PWA_UPDATE_LATER_NOTE}
      </div>
    </div>
  )
}
