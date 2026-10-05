/**
 * Service Worker 注册与更新提示的行为测试（步骤13）。
 *
 * 这里测的是**纯逻辑**（容器是注入的假实现）：注册路径、作用域、更新提示的触发条件、
 * 以及「只有用户点击才会让新版本接管」。真机行为（真的装上 SW、真的断网、真的更新一次）
 * 需要浏览器，属步骤14，本文件不假装验证过。
 *
 * 组件渲染用 `react-dom/server`（与项目其他组件测试同一套理由：不带 jsdom）；
 * 静态渲染不跑 effect，因此它验证的是「没有新版本时不渲染任何东西」这条默认态。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import UpdateNotice from './UpdateNotice'
import {
  applyWaitingUpdate,
  registerServiceWorker,
  type ServiceWorkerContainerLike,
  type ServiceWorkerLike,
  type ServiceWorkerRegistrationLike,
} from './registerServiceWorker'
import { PWA_UI_TEXTS } from './pwaText'

/** 一个可手动驱动的假 worker */
function fakeWorker(): ServiceWorkerLike & { readonly setState: (state: string) => void } {
  let state = 'installing'
  const listeners = new Set<() => void>()
  return {
    get state() {
      return state
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
    postMessage: () => undefined,
    setState: (next) => {
      state = next
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

type FakeRegistration = {
  waiting: ServiceWorkerLike | null
  installing: ServiceWorkerLike | null
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: () => void
}

type FakeContainer = ServiceWorkerContainerLike & {
  controller: unknown
  readonly __registration: FakeRegistration
  readonly registered: { readonly url: string; readonly scope?: string }[]
  readonly emitUpdateFound: () => void
}

function fakeContainer(
  options: { readonly fail?: boolean; readonly hasController?: boolean } = {},
): FakeContainer {
  const updatefoundListeners: (() => void)[] = []
  const registered: { url: string; scope?: string }[] = []
  const registration: FakeRegistration = {
    waiting: null,
    installing: null,
    addEventListener: (type, listener) => {
      if (type === 'updatefound') {
        updatefoundListeners.push(listener)
      }
    },
    removeEventListener: () => undefined,
  }

  return {
    controller: options.hasController === true ? {} : null,
    __registration: registration,
    registered,
    emitUpdateFound: () => {
      for (const listener of updatefoundListeners) {
        listener()
      }
    },
    register: (url, registerOptions) => {
      if (options.fail === true) {
        return Promise.reject(new Error('隐私模式禁止注册'))
      }
      registered.push({
        url,
        ...(registerOptions?.scope === undefined ? {} : { scope: registerOptions.scope }),
      })
      return Promise.resolve(registration as unknown as ServiceWorkerRegistrationLike)
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
}

describe('步骤13：注册 Service Worker', () => {
  it('开发模式下不注册（否则会缓存住开发资源）', async () => {
    const container = fakeContainer()
    const result = await registerServiceWorker({ container, dev: true })
    expect(result.status).toBe('skipped-dev')
    expect(container.registered).toHaveLength(0)
  })

  it('环境不支持时如实返回 unsupported（离线能力是增强项，不该让页面崩）', async () => {
    const result = await registerServiceWorker({ container: undefined, dev: false })
    expect(result.status).toBe('unsupported')
  })

  it('注册路径与作用域都跟着 base 走（子路径部署才不会 404）', async () => {
    const container = fakeContainer()
    const result = await registerServiceWorker({ container, baseUrl: '/intern-recruitment/' })
    expect(result.status).toBe('registered')
    expect(container.registered).toEqual([
      { url: '/intern-recruitment/sw.js', scope: '/intern-recruitment/' },
    ])
  })

  it('base 少写结尾斜杠也能得到合法作用域', async () => {
    const container = fakeContainer()
    await registerServiceWorker({ container, baseUrl: '/tools/review' })
    expect(container.registered).toEqual([
      { url: '/tools/review/sw.js', scope: '/tools/review/' },
    ])
  })

  it('注册失败只回报原因，不抛错', async () => {
    const container = fakeContainer({ fail: true })
    const result = await registerServiceWorker({ container })
    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.reason).toContain('隐私模式')
    }
  })
})

describe('步骤13：更新提示的触发条件', () => {
  it('首次安装（还没有 controller）不提示——那不是「更新」', async () => {
    const container = fakeContainer()
    const onUpdateReady = vi.fn()
    await registerServiceWorker({ container, onUpdateReady })
    const worker = fakeWorker()
    container.__registration.installing = worker
    container.emitUpdateFound()
    worker.setState('installed')
    expect(onUpdateReady).not.toHaveBeenCalled()
  })

  it('已有版本在控制页面 + 新版本装好 → 提示（但不自动接管）', async () => {
    const container = fakeContainer({ hasController: true })
    const onUpdateReady = vi.fn()
    await registerServiceWorker({ container, onUpdateReady })
    const worker = fakeWorker()
    container.__registration.installing = worker
    container.emitUpdateFound()
    worker.setState('installed')
    expect(onUpdateReady).toHaveBeenCalledTimes(1)
    // 关键：没有 skipWaiting、没有 reload —— 接管必须等用户点
    expect(worker.state).toBe('installed')
  })

  it('上次留下的等待中版本：注册完成立刻提示', async () => {
    const container = fakeContainer()
    container.__registration.waiting = fakeWorker()
    const onUpdateReady = vi.fn()
    await registerServiceWorker({ container, onUpdateReady })
    expect(onUpdateReady).toHaveBeenCalledTimes(1)
  })

  it('只有用户点击才让新版本接管：applyWaitingUpdate 只发 SKIP_WAITING', () => {
    const posted: unknown[] = []
    const waiting = { ...fakeWorker(), postMessage: (message: unknown) => posted.push(message) }
    const registration = { waiting, installing: null } as unknown as ServiceWorkerRegistrationLike

    expect(applyWaitingUpdate(null)).toBe(false)
    expect(applyWaitingUpdate({ waiting: null, installing: null } as unknown as ServiceWorkerRegistrationLike)).toBe(
      false,
    )
    expect(applyWaitingUpdate(registration)).toBe(true)
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }])
  })
})

describe('步骤13：更新提示组件', () => {
  it('没有新版本时不渲染任何东西（静态渲染即默认态）', () => {
    expect(renderToStaticMarkup(<UpdateNotice container={undefined} dev />)).toBe('')
  })

  it('文案里不出现自动刷新 / 后台重发的说法，且没有 Markdown 强调标记', () => {
    for (const text of PWA_UI_TEXTS) {
      expect(text).not.toContain('**')
      expect(text).not.toContain('__')
    }
    const joined = PWA_UI_TEXTS.join('\n')
    // 承诺要写清：不自动刷新、不影响本机数据、不缓存 AI 请求
    expect(joined).toContain('不会自动顶掉你正在看的页面')
    expect(joined).toContain('都不受影响')
    expect(joined).toContain('不会在后台重发任何请求')
    expect(joined).toContain('绝不缓存、排队或重发 AI 请求')
  })

  it('组件里没有 location.reload（刷新必须是用户点击触发的显式行为）', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(
      join(fileURLToPath(new URL('.', import.meta.url)), 'UpdateNotice.tsx'),
      'utf8',
    )
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).not.toContain('location.reload')
    expect(code).not.toContain('document.location')
  })
})
