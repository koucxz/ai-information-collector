export const splitInput = (value: string) => value
  .split(/[,，\n]/)
  .map((item) => item.trim())
  .filter(Boolean);

export const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
}).format(new Date(value));

export const formatRelativeTime = (value: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
  if (seconds < 604800) return Math.floor(seconds / 86400) + ' 天前';
  return formatTime(value);
};
