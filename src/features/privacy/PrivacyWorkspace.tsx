import {
  AI_EXCEPTION_CONDITIONS,
  AI_EXCEPTION_HEADING,
  AI_EXCEPTION_KEY_NOTE,
  AI_EXCEPTION_PAYLOAD_NOTE,
  AI_EXCEPTION_PROXY_NOTE,
  AI_EXCEPTION_STATUS,
  AI_EXCEPTION_VENDOR_NOTE,
  BACKUP_HEADING,
  BACKUP_PARAGRAPHS,
  CLEAR_DOES_NOT_DELETE_DOWNLOADS,
  CLEAR_DOES_NOT_TOUCH_OTHER_APPS,
  CLEAR_HEADING,
  CLEAR_OTHER_NOTES,
  CLEAR_PARAGRAPHS,
  LOCAL_ONLY_HEADING,
  LOCAL_ONLY_PARAGRAPHS,
  LOCAL_ONLY_SWITCH_NOTE,
  PRIVACY_PAGE_LEAD,
  PRIVACY_PAGE_TITLE,
  SANITIZE_HEADING,
  SANITIZE_PARAGRAPHS,
  STORAGE_BOUNDARY_FACTS,
  STORAGE_HEADING,
  STORAGE_PARAGRAPHS,
} from './privacyText'

const SECTION = 'space-y-3 rounded-lg border border-slate-200 bg-white p-4'
const H2 = 'text-sm font-semibold text-slate-900'
const P = 'text-xs leading-6 text-slate-700'
const UL = 'list-disc space-y-1 pl-5 text-xs leading-6 text-slate-700'

/**
 * 隐私与本地数据说明页（步骤12，docs/PRD.md 10.4 / 10.5 / 10.6）。
 *
 * 职责边界：
 * - 本组件**只摆放文本**，且所有字面量都来自 `./privacyText`：这一页是对外的事实声明，
 *   文案必须能被测试遍历（「有没有 Markdown 标记」「有没有过度承诺」），散在 JSX 里就测不全；
 * - 不调用任何存储 / 网络 API，也没有 `dangerouslySetInnerHTML`——全部经 React 文本节点渲染，
 *   因此任何内容都不会被当成 HTML 执行（AGENTS.md §6）；
 * - 「清除做不到什么」与「同源其他应用不受影响」两句话与设置页**共用同一份常量**
 *   （`CLEAR_DOES_NOT_*`），两处说法永远一致。
 */
export default function PrivacyWorkspace() {
  return (
    <article className="space-y-5">
      <header className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">{PRIVACY_PAGE_TITLE}</h2>
        <p className="text-xs leading-6 text-slate-700">{PRIVACY_PAGE_LEAD}</p>
      </header>

      <section className={SECTION}>
        <h2 className={H2}>{LOCAL_ONLY_HEADING}</h2>
        {LOCAL_ONLY_PARAGRAPHS.map((paragraph) => (
          <p className={P} key={paragraph}>
            {paragraph}
          </p>
        ))}
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">
          {LOCAL_ONLY_SWITCH_NOTE}
        </p>
      </section>

      <section className={SECTION}>
        <h2 className={H2}>{AI_EXCEPTION_HEADING}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-6 text-slate-700">
          {AI_EXCEPTION_CONDITIONS.map((condition) => (
            <li key={condition}>{condition}</li>
          ))}
        </ol>
        <p className={P}>{AI_EXCEPTION_PAYLOAD_NOTE}</p>
        <p className={P}>{AI_EXCEPTION_KEY_NOTE}</p>
        <p className={P}>{AI_EXCEPTION_VENDOR_NOTE}</p>
        <p className={P}>{AI_EXCEPTION_PROXY_NOTE}</p>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
          {AI_EXCEPTION_STATUS}
        </p>
      </section>

      <section className={SECTION}>
        <h2 className={H2}>{STORAGE_HEADING}</h2>
        {STORAGE_PARAGRAPHS.map((paragraph) => (
          <p className={P} key={paragraph}>
            {paragraph}
          </p>
        ))}
        <dl className="divide-y divide-slate-100 border-t border-slate-100">
          {STORAGE_BOUNDARY_FACTS.map((fact) => (
            <div className="py-2" key={fact.term}>
              <dt className="text-xs font-medium text-slate-900">{fact.term}</dt>
              <dd className="mt-1 text-xs leading-6 text-slate-600">{fact.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={SECTION}>
        <h2 className={H2}>{CLEAR_HEADING}</h2>
        {CLEAR_PARAGRAPHS.map((paragraph) => (
          <p className={P} key={paragraph}>
            {paragraph}
          </p>
        ))}
        <ul className={UL}>
          <li>{CLEAR_DOES_NOT_DELETE_DOWNLOADS}</li>
          <li>{CLEAR_DOES_NOT_TOUCH_OTHER_APPS}</li>
          {CLEAR_OTHER_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className={SECTION}>
        <h2 className={H2}>{BACKUP_HEADING}</h2>
        {BACKUP_PARAGRAPHS.map((paragraph) => (
          <p className={P} key={paragraph}>
            {paragraph}
          </p>
        ))}
      </section>

      <section className={SECTION}>
        <h2 className={H2}>{SANITIZE_HEADING}</h2>
        {SANITIZE_PARAGRAPHS.map((paragraph) => (
          <p className={P} key={paragraph}>
            {paragraph}
          </p>
        ))}
      </section>
    </article>
  )
}
