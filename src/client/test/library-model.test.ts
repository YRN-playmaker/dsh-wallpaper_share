import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appsForSub, formatInstalledAt, isLauncherApp, launcherAppDir, matchLauncherRecord,
  partitionApps, slugOfDir, type LauncherRecord, type LibraryApp,
} from '../library-model.ts';

const app = (id: string, title: string, source = '', type = 'application'): LibraryApp =>
  ({ id, title, file: title + '.exe', type, hasPreview: false, source });
const rec = (id: string, title: string, slug: string): LauncherRecord =>
  ({ id, title, slug, file: title + '.exe', installedAt: '2026-09-10T07:04:00.000Z' });

test('partitionApps：应用大类切分为 we应用 / 应用（启动器）', () => {
  const apps = [
    app('D:/we/workshop/content/431960/123', '工坊应用 A'),
    app('C:/Users/u/.dsh/storages/we-sync-apps/福瑞', '福瑞', 'launcher'),
    { id: 'D:/we/wallpapers/x', title: '某壁纸', file: 'a.mp4', type: 'video', hasPreview: true },
  ];
  const g = partitionApps(apps);
  assert.equal(g.all.length, 2, '非 application 类型不进「应用」大类');
  assert.deepEqual(g.we.map((a) => a.title), ['工坊应用 A']);
  assert.deepEqual(g.launcher.map((a) => a.title), ['福瑞']);
  assert.equal(isLauncherApp(apps[0]!), false);
});

test('appsForSub：三个二级分类取子集', () => {
  const apps = [app('a/1', 'we1'), app('r/app1', 'app1', 'launcher'), app('r/app2', 'app2', 'launcher')];
  assert.equal(appsForSub(apps, 'all').length, 3);
  assert.deepEqual(appsForSub(apps, 'we').map((a) => a.title), ['we1']);
  assert.deepEqual(appsForSub(apps, 'launcher').map((a) => a.title), ['app1', 'app2']);
});

test('slugOfDir：正反斜杠、尾随分隔符、空串都取到末段', () => {
  assert.equal(slugOfDir('D:/SteamLibrary/workshop/content/431960/1234'), '1234');
  assert.equal(slugOfDir('C:\\Users\\me\\.dsh\\storages\\we-sync-apps\\福瑞'), '福瑞');
  assert.equal(slugOfDir('C:/apps/we-sync-apps/福瑞/'), '福瑞');
  assert.equal(slugOfDir(''), '');
});

test('matchLauncherRecord：先按目录末段 slug，source=launcher 才按标题兜底，都没有则 null', () => {
  const records = [rec('furry', '福瑞', '福瑞'), rec('tool', '小工具', 'tool-x')];
  // 目录 = 安装根/slug
  assert.equal(matchLauncherRecord(app('C:/apps/we-sync-apps/tool-x', '小工具', 'launcher'), records)?.id, 'tool');
  // 标题兜底：启动器装的包被重命名过目录
  assert.equal(matchLauncherRecord(app('C:/apps/renamed-dir', '福瑞', 'launcher'), records)?.id, 'furry');
  // 工坊应用即使标题撞名也绝不匹配（否则「卸载」会删掉另一条启动器记录）
  assert.equal(matchLauncherRecord(app('D:/workshop/431960/999', '福瑞'), records), null);
  assert.equal(matchLauncherRecord(app('C:/apps/nothing', '不存在', 'launcher'), records), null);
});

test('formatInstalledAt：本地时间 YYYY-MM-DD HH:mm；非法值原样回显', () => {
  const local = new Date(2026, 8, 10, 15, 4, 0);
  assert.equal(formatInstalledAt(local.toISOString()), '2026-09-10 15:04');
  assert.equal(formatInstalledAt('不是时间'), '不是时间');
  assert.equal(formatInstalledAt(''), '');
});

test('launcherAppDir：拼安装根与 slug，统一反斜杠并去掉尾部分隔符', () => {
  assert.equal(launcherAppDir('C:/Users/u/.dsh/storages/we-sync-apps', '福瑞'), 'C:\\Users\\u\\.dsh\\storages\\we-sync-apps\\福瑞');
  assert.equal(launcherAppDir('D:\\Games\\WeApps\\', 'tool'), 'D:\\Games\\WeApps\\tool');
  assert.equal(launcherAppDir('', 'tool'), 'tool', '根未知时至少给出 slug');
});
