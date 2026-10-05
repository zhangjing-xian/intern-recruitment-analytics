/**
 * 本地确定性结论与规则化行动建议（步骤10 建立）。
 *
 * 与 `src/domain` 的分工：`domain/analytics` 只出**计数与率**，本目录出**结论**
 * （把指标按 PRD 9 章的规则组合成可解释的运营关注标签与建议）。
 * 界面只 `import ... from '../insights'`，不得自己拼结论，也不得在组件里判断阈值。
 *
 * 边界：纯函数，不依赖 React / 网络 / 存储；不调用 AI；不生成任何概率。
 */

export * from './rejection'
