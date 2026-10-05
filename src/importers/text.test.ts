import { describe, expect, it } from 'vitest'

import {
  LineCounter,
  buildTextPreview,
  countLineBreaks,
  decodeText,
  detectDelimiter,
  detectEncoding,
  stripBom,
} from './text'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('编码识别与解码', () => {
  it('UTF-8 BOM 会被识别并去掉，同时报告 BOM 存在', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('需求ID')])
    const detection = detectEncoding(bytes)
    expect(detection).toMatchObject({ encoding: 'utf-8', source: 'bom', hasBom: true })

    const decoded = decodeText(bytes, 'utf-8')
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.text).toBe('需求ID')
      expect(decoded.hasBom).toBe(true)
      expect(decoded.replacementCount).toBe(0)
    }
    expect(stripBom('\uFEFF需求ID')).toBe('需求ID')
  })

  it('合法 UTF-8（无 BOM）按 utf-8 判定，纯 ASCII 文件不产生噪声提示', () => {
    expect(detectEncoding(utf8('id,name\n1,2\n'))).toMatchObject({
      encoding: 'utf-8',
      source: 'utf8-valid',
      hint: null,
    })
  })

  it('不是合法 UTF-8 时回退 GB18030 并给出可读提示（不擅自改内容）', () => {
    // '你好' 的 GB18030 字节：C4 E3 BA C3
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])
    const detection = detectEncoding(bytes)
    expect(detection.encoding).toBe('gb18030')
    expect(detection.source).toBe('fallback')
    expect(detection.hint).toContain('GB18030')

    const decoded = decodeText(bytes, 'gb18030')
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.text).toBe('你好')
    }
  })

  it('用错编码不会抛异常，但会报告替换字符个数，供界面提示用户改选', () => {
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])
    const decoded = decodeText(bytes, 'utf-8')
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.replacementCount).toBeGreaterThan(0)
    }
  })

  it('UTF-16 LE（带 BOM）按 utf-16le 解码', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])
    expect(detectEncoding(bytes).encoding).toBe('utf-16le')
    const decoded = decodeText(bytes, 'utf-16le')
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.text).toBe('AB')
    }
  })
})

describe('分隔符识别', () => {
  it('按首个有内容的一行统计，取出现最多的分隔符', () => {
    expect(detectDelimiter('a,b,c\n1,2,3').delimiter).toBe(',')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3').delimiter).toBe('\t')
    expect(detectDelimiter('a;b;c\n1;2;3').delimiter).toBe(';')
  })

  it('引号内的分隔符不计入统计（带逗号的字段不会让 TSV 判成 CSV）', () => {
    const tsv = '需求ID\t姓名\nREQ-001\t"候选人, 甲"\n'
    const detection = detectDelimiter(tsv)
    expect(detection.delimiter).toBe('\t')
    expect(detection.counts['\t']).toBe(1)
    expect(detection.counts[',']).toBe(0)
  })

  it('单列文本识别不出分隔符时返回 null（由调用方按来源给默认值）', () => {
    const detection = detectDelimiter('只有一列\nREQ-001\n')
    expect(detection.delimiter).toBeNull()
  })

  it('空文本不报错', () => {
    expect(detectDelimiter('').delimiter).toBeNull()
  })
})

describe('物理行号换算', () => {
  it('LF / CRLF / CR 都算一次换行', () => {
    expect(countLineBreaks('a\nb\nc')).toBe(2)
    expect(countLineBreaks('a\r\nb\r\nc')).toBe(2)
    expect(countLineBreaks('a\rb\rc')).toBe(2)
  })

  it('字段内的换行也占一行，行号与 Excel 里看到的一致', () => {
    const text = 'a,b\r\n"x\n1",y\r\nz,w\r\n'
    const counter = new LineCounter(text)
    expect(counter.lineNumberAt(0)).toBe(1)
    expect(counter.lineNumberAt(5)).toBe(2)
    expect(counter.lineNumberAt(14)).toBe(4)
    expect(counter.lineNumberAt(19)).toBe(5)
  })

  it('游标只增不减：重复调用不会回退行号', () => {
    const counter = new LineCounter('a\nb\nc')
    expect(counter.lineNumberAt(4)).toBe(3)
    expect(counter.lineNumberAt(1)).toBe(3)
  })
})

describe('原文预览', () => {
  it('只取前若干行并截断过长行，标记是否截断', () => {
    const preview = buildTextPreview('第一行\n第二行\n第三行\n', 2, 10)
    expect(preview.lines).toEqual(['第一行', '第二行'])
    expect(preview.truncatedLines).toBe(true)

    const truncated = buildTextPreview('0123456789abcdef', 1, 10)
    expect(truncated.lines).toEqual(['0123456789…'])
    expect(truncated.truncatedChars).toBe(true)
  })
})
