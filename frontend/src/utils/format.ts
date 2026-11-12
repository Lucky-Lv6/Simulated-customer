/** 通用展示格式化工具 */

/** 秒 → `m:ss` */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 秒 → `X分Y秒` */
export function formatDurationCN(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(safe / 60)}分${safe % 60}秒`;
}

/** 百分制分数 → 颜色（红绿蓝三段） */
export function getScoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

/** 百分制分数 → 文字评级 */
export function getScoreLabel(score: number): string {
  if (score >= 90) return '优秀';
  if (score >= 80) return '良好';
  if (score >= 70) return '中等';
  if (score >= 60) return '需提升';
  return '待加强';
}
