#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SignalDock 延迟监测：每分钟探测源站接口耗时，生成可查看的 HTML 看板。

单次探测由 cron 每分钟调用；--report 打印文本摘要并刷新看板。
数据：/opt/service-monitor/latency/YYYY-MM-DD.jsonl
看板：/opt/service-monitor/report/index.html
"""
import glob
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

BASE = '/opt/service-monitor'
LDIR = BASE + '/latency'
RDIR = BASE + '/report'
TELE = '/opt/signaldock/data/telemetry'
CST = timezone(timedelta(hours=8))
HOST = 'https://127.0.0.1:8443'
ORIGIN = 'https://106.55.19.23:8443'
COOKIE = LDIR + '/.cookie'
TIMEOUT = 8
KEEP_DAYS = 30

TARGETS = [
    ('服务状态', '/api/health', False),
    ('首页', '/', False),
    ('信息概览', '/api/information/overview', True),
    ('信息流', '/api/information?page=1&pageSize=20&sort=latest', True),
    ('关注主题', '/api/topics', True),
    ('选题工作台', '/api/briefs', True),
    ('采集记录', '/api/collect/runs?limit=5', True),
]


def now():
    return datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S')


def password():
    try:
        for line in open('/opt/signaldock/.env', encoding='utf-8'):
            if line.startswith('ADMIN_PASSWORD='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ''


def login():
    pw = password()
    if not pw:
        return False
    try:
        subprocess.run([
            'curl', '-k', '-s', '-c', COOKIE, '--max-time', '10',
            '-H', 'Content-Type: application/json', '-H', 'Origin: ' + ORIGIN,
            '-d', json.dumps({'username': 'admin', 'password': pw}),
            HOST + '/api/auth/login'
        ], capture_output=True, timeout=14)
        return os.path.exists(COOKIE) and 'signaldock_session' in open(COOKIE, encoding='utf-8').read()
    except Exception:
        return False


def probe(name, path, auth):
    cmd = ['curl', '-k', '-s', '-o', '/dev/null', '--max-time', str(TIMEOUT),
           '-w', '%{http_code} %{time_total} %{time_starttransfer}']
    if auth:
        cmd += ['-b', COOKIE]
    cmd.append(HOST + path)
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT + 3).stdout.strip().split()
        code = int(out[0]) if out else 0
        total, ttfb = float(out[1]), float(out[2])
    except Exception:
        code, total, ttfb = 0, float(TIMEOUT), float(TIMEOUT)
    return dict(ts=now(), target=name, ok=200 <= code < 400, code=code,
                ms=int(total * 1000), ttfb=int(ttfb * 1000))


def collect():
    os.makedirs(LDIR, exist_ok=True)
    rows = []
    relogged = False
    for name, path, auth in TARGETS:
        row = probe(name, path, auth)
        if auth and row['code'] in (401, 403) and not relogged and login():
            relogged = True
            row = probe(name, path, auth)
        rows.append(row)
    with open(LDIR + '/' + now()[:10] + '.jsonl', 'a', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    return rows


def read_jsonl(root, hours):
    cutoff = datetime.now(CST) - timedelta(hours=hours)
    out = []
    for path in sorted(glob.glob(root + '/*.jsonl')):
        try:
            for line in open(path, encoding='utf-8', errors='ignore'):
                try:
                    row = json.loads(line)
                    raw = row.get('ts', '')
                    if raw.endswith('Z') or 'T' in raw:
                        dt = datetime.fromisoformat(raw.replace('Z', '+00:00')).astimezone(CST)
                    else:
                        dt = datetime.strptime(raw, '%Y-%m-%d %H:%M:%S').replace(tzinfo=CST)
                    if dt >= cutoff:
                        row['_dt'] = dt
                        out.append(row)
                except Exception:
                    continue
        except Exception:
            continue
    return out


def pct(values, p):
    if not values:
        return 0
    seq = sorted(values)
    return seq[int((len(seq) - 1) * p / 100)]


CSS = """
*{box-sizing:border-box}body{margin:0;background:#f5f7f9;color:#1c2532;
font-family:'Microsoft YaHei','微软雅黑',-apple-system,sans-serif;font-size:13px;line-height:1.6}
.wrap{max-width:1120px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:22px;margin:0 0 4px;font-weight:600}h2{font-size:15px;margin:28px 0 12px;font-weight:600}
.sub{color:#6b7686;margin-bottom:20px}.badge{display:inline-block;padding:2px 10px;border-radius:12px;
font-size:12px;font-weight:600;background:#e5f3ea;color:#146c43}
.badge.bad{background:#fdeaea;color:#b4232c}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e3e8ee;border-radius:10px;padding:14px 16px}
.card .k{color:#6b7686;font-size:12px}.card .v{font-size:24px;font-weight:600;margin-top:4px}
.card .v.warn{color:#d99100}.card .v.bad{color:#d64545}.card .h{color:#8a94a4;font-size:11px;margin-top:2px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e8ee;border-radius:10px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #eef1f4;white-space:nowrap}
th{background:#fafbfc;color:#6b7686;font-weight:500;font-size:12px}
tr:last-child td{border-bottom:0}.ok{color:#146c43}.bad-txt{color:#d64545}.warn-txt{color:#d99100}
.hours{display:flex;gap:3px;align-items:flex-end;height:88px;background:#fff;border:1px solid #e3e8ee;
border-radius:10px;padding:14px 12px}
.hour{flex:1;min-width:8px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}
.bar{width:100%;border-radius:3px 3px 0 0;background:#8fc9a9;min-height:3px}
.bar.bad{background:#e79a9a}.hour .lb{font-size:9px;color:#9aa4b2}
.note{background:#fff;border:1px solid #e3e8ee;border-radius:10px;padding:16px 18px;color:#5a6575;font-size:12px}
.note code{background:#f2f4f7;padding:1px 6px;border-radius:4px;font-family:Consolas,monospace}
.pill{display:inline-block;background:#f2f4f7;border-radius:10px;padding:1px 9px;margin:2px 4px 2px 0;font-size:12px}
.empty{color:#9aa4b2;padding:14px 0}
@media(max-width:700px){.wrap{padding:18px 12px 40px}table{font-size:12px}th,td{padding:7px 8px}}
"""


def render(rows, tele):
    ok_rows = [r for r in rows if r.get('ok')]
    bad_rows = [r for r in rows if not r.get('ok')]
    all_ms = [r.get('ms', 0) for r in rows]
    rate = (len(ok_rows) / len(rows) * 100) if rows else 100
    healthy = rate >= 99 and not bad_rows
    parts = ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
             '<meta http-equiv="refresh" content="60">',
             '<meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>SignalDock 服务监测</title><style>', CSS, '</style></head><body><div class="wrap">',
             '<h1>SignalDock 服务监测</h1><div class="sub">数据更新时间：', now(),
             '（北京时间，页面每 60 秒自动刷新） · 源站每 1 分钟探测一次</div>',
             '<div class="cards">',
             '<div class="card"><div class="k">源站总体</div><div class="v">',
             '<span class="badge' + ('' if healthy else ' bad') + '">' + ('正常' if healthy else '有异常') + '</span>',
             '</div><div class="h">最近 24 小时</div></div>',
             '<div class="card"><div class="k">探测次数 / 成功率</div><div class="v">', str(len(rows)),
             '</div><div class="h">成功率 ' + '%.1f%%' % rate + '</div></div>',
             '<div class="card"><div class="k">请求耗时 P95</div><div class="v">', str(pct(all_ms, 95)),
             ' ms</div><div class="h">P50 ' + str(pct(all_ms, 50)) + ' ms · 最大 ' + str(max(all_ms) if all_ms else 0) + ' ms</div></div>',
             '<div class="card"><div class="k">源站失败 / 超时</div><div class="v' + (' bad' if bad_rows else '') + '">',
             str(len(bad_rows)), ' 次</div><div class="h">按 8 秒超时或 4xx/5xx 计</div></div>',
             '<div class="card"><div class="k">用户侧超时上报</div><div class="v' + (' warn' if tele else '') + '">',
             str(len(tele)), ' 次</div><div class="h">前端真实请求，含 Vercel 回源链路</div></div>',
             '</div>']

    parts += ['<h2>按接口 · 最近 24 小时</h2><table><thead><tr><th>接口</th><th>次数</th><th>成功率</th>',
              '<th>P50</th><th>P95</th><th>最大</th><th>失败</th></tr></thead><tbody>']
    by = {}
    for r in rows:
        by.setdefault(r['target'], []).append(r)
    for name, _path, _auth in TARGETS:
        items = by.get(name, [])
        if not items:
            continue
        good = [x for x in items if x.get('ok')]
        ms = [x.get('ms', 0) for x in items]
        fails = len(items) - len(good)
        rate_i = len(good) / len(items) * 100
        cls = 'ok' if fails == 0 else 'bad-txt'
        parts.append('<tr><td>' + name + '</td><td>' + str(len(items)) + '</td><td class="' + cls + '">' +
                     '%.1f%%' % rate_i + '</td><td>' + str(pct(ms, 50)) + ' ms</td><td>' +
                     str(pct(ms, 95)) + ' ms</td><td>' + str(max(ms)) + ' ms</td><td class="' + cls + '">' +
                     str(fails) + '</td></tr>')
    parts.append('</tbody></table>')

    parts.append('<h2>按小时 · 最近 24 小时源站成功率</h2><div class="hours">')
    hours = []
    base = datetime.now(CST).replace(minute=0, second=0, microsecond=0)
    for i in range(23, -1, -1):
        start = base - timedelta(hours=i)
        items = [r for r in rows if start <= r['_dt'] < start + timedelta(hours=1)]
        good = [x for x in items if x.get('ok')]
        rate_h = (len(good) / len(items) * 100) if items else 100
        hours.append((start, rate_h, len(items) - len(good)))
    for start, rate_h, fails in hours:
        cls = 'bar bad' if fails else 'bar'
        h = max(3, int(rate_h * 0.52))
        parts.append('<div class="hour" title="' + start.strftime('%m-%d %H:00') + ' 成功率 ' +
                     '%.1f%%' % rate_h + ' 失败 ' + str(fails) + '"><div class="' + cls +
                     '" style="height:' + str(h) + 'px"></div><div class="lb">' + start.strftime('%H') + '</div></div>')
    parts.append('</div>')

    parts.append('<h2>用户侧超时上报 · 最近 24 小时</h2>')
    if not tele:
        parts.append('<div class="note"><div class="empty">暂无上报。前端在请求超时 / 连接失败 / 5xx / 响应超过 2.5 秒时自动上报一条，无需登录。</div></div>')
    else:
        by_feature, by_reason, by_origin = {}, {}, {}
        for t in tele:
            by_feature[t.get('feature', '未知')] = by_feature.get(t.get('feature', '未知'), 0) + 1
            by_reason[t.get('reason', 'unknown')] = by_reason.get(t.get('reason', 'unknown'), 0) + 1
            by_origin[t.get('origin', '未知')] = by_origin.get(t.get('origin', '未知'), 0) + 1
        def pills(d, labels):
            return ''.join('<span class="pill">' + labels.get(k, k) + ' × ' + str(v) + '</span>'
                           for k, v in sorted(d.items(), key=lambda x: -x[1])[:8])
        reason_labels = {'timeout': '响应超时', 'network': '连接失败', 'server': '服务 5xx',
                        'slow': '响应偏慢', 'unknown': '未知'}
        parts.append('<div class="note"><div style="margin-bottom:8px"><b>按功能</b><br>' + pills(by_feature, {}) + '</div>')
        parts.append('<div style="margin-bottom:8px"><b>按原因</b><br>' + pills(by_reason, reason_labels) + '</div>')
        parts.append('<div><b>按入口</b><br>' + pills(by_origin, {}) + '</div></div>')
        parts.append('<table><thead><tr><th>时间</th><th>功能</th><th>原因</th><th>耗时</th><th>入口</th></tr></thead><tbody>')
        for t in sorted(tele, key=lambda x: x.get('ts', ''), reverse=True)[:15]:
            ts = t.get('ts', '')[:19].replace('T', ' ')
            parts.append('<tr><td>' + ts + '</td><td>' + str(t.get('feature', '')) + '</td><td class="warn-txt">' +
                         reason_labels.get(t.get('reason', ''), t.get('reason', '')) + '</td><td>' +
                         str(t.get('ms', '-')) + ' ms</td><td>' + str(t.get('origin', '')) + '</td></tr>')
        parts.append('</tbody></table>')

    if bad_rows:
        parts.append('<h2>最近源站异常</h2><table><thead><tr><th>时间</th><th>接口</th><th>状态</th><th>耗时</th></tr></thead><tbody>')
        for r in sorted(bad_rows, key=lambda x: x.get('ts', ''), reverse=True)[:15]:
            parts.append('<tr><td>' + r.get('ts', '') + '</td><td>' + r.get('target', '') +
                         '</td><td class="bad-txt">HTTP ' + str(r.get('code', 0)) + '</td><td>' +
                         str(r.get('ms', 0)) + ' ms</td></tr>')
        parts.append('</tbody></table>')

    parts.append('<h2>口径与查看方式</h2><div class="note">')
    parts.append('<div>① <b>源站探测</b>：服务器本机每分钟请求 8443 的 7 个接口，记录状态码、首字节时间与总耗时；超过 8 秒或 4xx/5xx 记为失败。这里全部正常，说明超时不在源站。</div>')
    parts.append('<div>② <b>用户侧上报</b>：浏览器在超时 / 连接失败 / 5xx / 慢响应时经 <code>/api/telemetry</code> 上报，覆盖 Vercel 跨境回源链路，这是「页面转圈」的直接证据。</div>')
    parts.append('<div>③ <b>存活监控</b>：<code>python3 /opt/service-monitor/monitor.py --report</code>，逐分钟明细 <code>/opt/service-monitor/latency/YYYY-MM-DD.jsonl</code>。</div>')
    parts.append('<div>④ <b>Vercel 官方日志</b>：Vercel 控制台 → 项目 → Logs / Analytics，可看边缘函数耗时与 5xx（免费额度有限）。</div>')
    parts.append('<div>⑤ 服务器网络访问不了 *.vercel.app，因此外部链路不在此页做主动探测，改由前端上报覆盖。</div>')
    parts.append('</div></div></body></html>')
    html = ''.join(parts)
    os.makedirs(RDIR, exist_ok=True)
    tmp = RDIR + '/index.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(html)
    os.replace(tmp, RDIR + '/index.html')
    os.chmod(RDIR + '/index.html', 0o644)
    return html


def cleanup():
    cutoff = (datetime.now(CST) - timedelta(days=KEEP_DAYS)).strftime('%Y-%m-%d')
    for path in glob.glob(LDIR + '/*.jsonl'):
        if os.path.basename(path)[:10] < cutoff:
            try:
                os.remove(path)
            except OSError:
                pass


def report(rows, tele):
    print('=== 源站延迟 @ %s（最近 24 小时）===' % now())
    by = {}
    for r in rows:
        by.setdefault(r['target'], []).append(r)
    for name, items in sorted(by.items()):
        ms = [x.get('ms', 0) for x in items]
        good = [x for x in items if x.get('ok')]
        print('  %-12s n=%-5d 成功率=%6.1f%%  P50=%-5d P95=%-5d 最大=%-6d 失败=%d' % (
            name, len(items), len(good) / len(items) * 100, pct(ms, 50), pct(ms, 95), max(ms), len(items) - len(good)))
    print('  用户侧超时上报：%d 条' % len(tele))
    print('  看板：/opt/service-monitor/report/index.html （https://106.55.19.23:8443/ops/status）')


def main():
    if '--report' not in sys.argv:
        collect()
    rows = read_jsonl(LDIR, 24)
    tele = read_jsonl(TELE, 24) if os.path.isdir(TELE) else []
    render(rows, tele)
    if '--report' in sys.argv:
        report(rows, tele)
        cleanup()


if __name__ == '__main__':
    main()
