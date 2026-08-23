// src/client/i18n.ts

export const messages = {
  zh: {
    panelTitle: 'Wallpaper Engine 壁纸同步',
    syncStatus: '同步状态',
    syncEnabled: '已启用',
    syncDisabled: '已停用',
    autoSync: '实时同步',
    
    // 显示器
    monitorSelect: '显示器来源',
    monitorAuto: '自动跟随最新活动',
    monitorLocked: '锁定为背景来源',
    monitorLabel: '显示器',

    // 视觉调节
    visualControls: '视觉效果',
    opacity: '面板透明度',
    blur: '背景模糊度',
    shadow: '阴影深度',

    // 渲染模式
    renderMode: '渲染模式',
    modePerformance: '性能模式（静态预览）',
    modeEnhanced: '增强模式（加载源内容）',
    modeNotice: 'Scene 壁纸增强模式显示提取的高清背景纹理',

    // 专注模式
    focusMode: '专注模式 🎯',
    focusDesc: '任务进行中自动压暗背景，任务完成后恢复通透',
    focusActive: '专注中',
    focusIdle: '空闲',

    // 诊断与提示
    diagnostics: '自诊断路由',
    weNotFound: '未检测到 Wallpaper Engine 安装目录',
    lastChanged: '最近变化',
  },
  en: {
    panelTitle: 'Wallpaper Engine Sync',
    syncStatus: 'Sync Status',
    syncEnabled: 'Enabled',
    syncDisabled: 'Disabled',
    autoSync: 'Live Sync',

    // Monitor
    monitorSelect: 'Monitor Source',
    monitorAuto: 'Auto (Follow Most Recent)',
    monitorLocked: 'Locked as Background',
    monitorLabel: 'Monitor',

    // Visual controls
    visualControls: 'Visual Adjustments',
    opacity: 'Panel Transparency',
    blur: 'Background Blur',
    shadow: 'Shadow Depth',

    // Render mode
    renderMode: 'Render Mode',
    modePerformance: 'Performance (Static Preview)',
    modeEnhanced: 'Enhanced (Load Source Content)',
    modeNotice: 'Scene wallpapers display extracted HD background texture in Enhanced mode',

    // Focus mode
    focusMode: 'Focus Mode 🎯',
    focusDesc: 'Darkens background while tasks run, restores clarity when idle',
    focusActive: 'Focusing',
    focusIdle: 'Idle',

    // Diagnostics & warnings
    diagnostics: 'Self-Diagnostics',
    weNotFound: 'Wallpaper Engine directory not detected',
    lastChanged: 'Last Changed',
  }
};

export type LocaleKey = keyof typeof messages.zh;
export type SupportedLang = 'zh' | 'en';