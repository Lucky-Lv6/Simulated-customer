/**
 * 资料台词字符匹配。
 *
 * 上传的资料若包含「我：/客户：」台词对，前端会持续把用户这段话与资料中的
 * 「我」台词做模糊匹配；匹配成功后把该句序号随 WebSocket 一起发给后端，
 * 由后端返回对应「客户」台词（一字不落）。
 */

import type { ScriptLine } from '../types';

/** 去掉标点与空白，统一大小写，便于做模糊比较 */
const normalizeForMatch = (s: string) =>
  s
    .replace(/[\s，。？！、,.!?;；:：""''「」『』（）()\[\]【】~～—\-…]/g, '')
    .toLowerCase();

/** 最长公共子序列长度（滚动数组实现，O(n*m) 时间 / O(m) 空间） */
function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length];
}

/** 在资料台词中找出与用户当前这段话最匹配的一句「我」台词 */
export function matchScriptLine(
  text: string,
  lines: ScriptLine[] | undefined,
  fromIndex: number,
): { index: number; score: number } | null {
  const a = normalizeForMatch(text);
  if (!a || !lines?.length) return null;

  let best: { index: number; score: number } | null = null;
  const candidates = lines
    .filter((l) => l.fde && l.fde.trim() && l.index >= fromIndex)
    .slice(0, 6);

  for (const line of candidates) {
    const b = normalizeForMatch(line.fde);
    if (!b) continue;

    const lcs = lcsLength(a, b);
    const dice = (2 * lcs) / (a.length + b.length);
    const recall = lcs / b.length;
    const lenRatio = a.length / b.length;

    let ok: boolean;
    if (b.length <= 3) {
      // 极短台词（如“嗯”“对”）：包含关系且长度接近即可
      ok = lenRatio <= 2.0 && (a === b || a.includes(b) || b.includes(a));
    } else if (b.length <= 8) {
      // 短句：要求说满 85% 且相似度高，避免误触发
      ok = dice >= 0.82 && lenRatio >= 0.85 && lenRatio <= 1.8;
    } else {
      // 长句：说满约 95% 以上且相似度高才算说完这句台词
      ok = dice >= 0.7 && lenRatio >= 0.95 && lenRatio <= 1.9;
      if (!ok && recall >= 0.97 && lenRatio <= 2.0) ok = true;
    }

    if (ok && (!best || dice > best.score)) {
      best = { index: line.index, score: dice };
    }
  }

  return best;
}

/** 去掉“用户发言”开头混进来的客户回音（麦克风拾取到刚播放的客户语音） */
export function stripEchoPrefix(raw: string, echo: string): string {
  const ne = normalizeForMatch(echo);
  if (ne.length < 4) return raw;
  const na = normalizeForMatch(raw);
  if (!na) return raw;

  // 模糊匹配：ASR 可能把回音里的字听错（如“您”听成“你”），
  // 因此不要求完全一致，而是看开头这段文字与客户台词的重合度。
  const windowLen = Math.min(na.length, Math.ceil(ne.length * 1.2));
  const head = na.slice(0, windowLen);
  const lcs = lcsLength(head, ne);
  const recall = lcs / ne.length;
  const precision = lcs / Math.max(head.length, 1);
  if (recall < 0.7 || precision < 0.6) {
    return raw;
  }

  let count = 0;
  let i = 0;
  const ignored = /[\s，。？！、,.!?;；:：""''「」『』（）()\[\]【】~～—\-…]/;
  while (i < raw.length && count < windowLen) {
    if (!ignored.test(raw[i])) count++;
    i++;
  }
  return raw.slice(i).trim();
}
